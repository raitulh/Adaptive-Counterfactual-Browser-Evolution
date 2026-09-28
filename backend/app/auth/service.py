"""Authentication use-cases: registration, login, token rotation, sessions, MFA.

Design:
* Access tokens: short-lived JWTs (``sub``/``sid``/``tid``). Every request also
  checks the session row, so revoking a session takes effect immediately.
* Refresh tokens: opaque, stored as SHA-256 digests, rotated on every use.
  Presenting a token that was already used revokes the whole session
  (refresh-token reuse ⇒ presumed theft).
* Brute force: per-IP and per-account rate limits (Redis) plus a DB-backed
  lockout counter that survives Redis loss.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.auth import totp
from app.auth.models import AuthSession, MfaFactor, RefreshToken
from app.auth.schemas import TokenResponse
from app.common.context import RequestContext
from app.common.time import ensure_aware, utcnow
from app.core.config import Settings, get_settings
from app.core.crypto import get_key_manager
from app.core.database import set_system_scope
from app.core.exceptions import Conflict, Forbidden, NotFound, Unauthorized, ValidationFailed
from app.core.security import (
    create_access_token,
    decode_access_token,
    generate_opaque_token,
    hash_password,
    hash_token,
    password_needs_rehash,
    verify_password,
)
from app.organizations import repository as org_repo
from app.organizations.service import create_organization
from app.users.models import User, UserStatus

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class ClientInfo:
    ip: str | None = None
    user_agent: str | None = None
    device_name: str | None = None


@dataclass(slots=True)
class IssuedTokens:
    response: TokenResponse
    refresh_token: str


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    return (
        await session.execute(select(User).where(func.lower(User.email) == email.strip().lower()))
    ).scalar_one_or_none()


# ------------------------------------------------------------------ registration
async def register(session: AsyncSession, *, email: str, password: str, display_name: str | None,
                   organization_name: str | None, timezone: str, client: ClientInfo) -> IssuedTokens:
    set_system_scope(session)  # unauthenticated flow: trusted system code, no caller tenant yet
    if await get_user_by_email(session, email) is not None:
        # Uniform, non-enumerating message; the unique index is the real guard.
        raise Conflict("Unable to register with these details", code="registration_failed")
    user = User(email=email.strip().lower(), password_hash=hash_password(password), display_name=display_name,
                timezone=timezone)
    session.add(user)
    await session.flush()
    org = await create_organization(session, name=organization_name or f"{display_name or 'Personal'} workspace",
                                    owner=user, personal=organization_name is None)
    user.default_tenant_id = org.id
    tokens = await _start_session(session, user, org.id, client, auth_method="password", mfa_verified=False)
    audit.record(session, category=AuditCategory.AUTH, action="auth.register", tenant_id=org.id, user_id=user.id,
                 actor_type="user", ip=client.ip, user_agent=client.user_agent, resource_type="user",
                 resource_id=user.id)
    await session.commit()
    return tokens


# ------------------------------------------------------------------ login
async def login(session: AsyncSession, *, email: str, password: str, mfa_code: str | None,
                client: ClientInfo, settings: Settings | None = None) -> IssuedTokens:
    set_system_scope(session)  # unauthenticated flow: trusted system code, no caller tenant yet
    settings = settings or get_settings()
    user = await get_user_by_email(session, email)
    now = utcnow()
    password_ok = verify_password(password, user.password_hash if user else None)

    if user is None or user.status != UserStatus.ACTIVE or user.deleted_at is not None:
        await audit.record_independent(category=AuditCategory.SECURITY, action="auth.login.failed",
                                       status="failure", ip=client.ip, user_agent=client.user_agent,
                                       metadata={"reason": "unknown_or_inactive_account"})
        raise Unauthorized("Invalid credentials", code="invalid_credentials")

    if user.locked_until is not None and ensure_aware(user.locked_until) > now:
        await audit.record_independent(category=AuditCategory.SECURITY, action="auth.login.locked",
                                       status="denied", user_id=user.id, ip=client.ip,
                                       user_agent=client.user_agent)
        raise Unauthorized("Invalid credentials", code="invalid_credentials")

    if not password_ok:
        user.failed_login_count += 1
        locked = user.failed_login_count >= settings.login_max_failures
        if locked:
            user.locked_until = now + timedelta(seconds=settings.login_lockout_seconds)
            user.failed_login_count = 0
        await session.commit()
        await audit.record_independent(category=AuditCategory.SECURITY, action="auth.login.failed",
                                       status="failure", user_id=user.id, ip=client.ip,
                                       user_agent=client.user_agent,
                                       metadata={"reason": "bad_password", "locked": locked})
        raise Unauthorized("Invalid credentials", code="invalid_credentials")

    mfa_verified = False
    if user.mfa_enabled:
        if not mfa_code:
            raise Unauthorized("Multi-factor authentication code required", code="mfa_required")
        if not await verify_mfa_code(session, user, mfa_code):
            await audit.record_independent(category=AuditCategory.SECURITY, action="auth.mfa.failed",
                                           status="failure", user_id=user.id, ip=client.ip)
            raise Unauthorized("Invalid credentials", code="invalid_credentials")
        mfa_verified = True

    user.failed_login_count = 0
    user.locked_until = None
    user.last_login_at = now
    if user.password_hash and password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)

    tenant_id = await _resolve_login_tenant(session, user)
    tokens = await _start_session(session, user, tenant_id, client, auth_method="password",
                                  mfa_verified=mfa_verified)
    audit.record(session, category=AuditCategory.AUTH, action="auth.login", tenant_id=tenant_id, user_id=user.id,
                 actor_type="user", ip=client.ip, user_agent=client.user_agent,
                 metadata={"session_id": str(tokens.response.session_id), "mfa": mfa_verified})
    await session.commit()
    return tokens


async def _resolve_login_tenant(session: AsyncSession, user: User) -> uuid.UUID:
    if user.default_tenant_id is not None:
        membership = await org_repo.get_active_membership(session, user.id, user.default_tenant_id)
        if membership is not None:
            return user.default_tenant_id
    memberships = await org_repo.list_user_memberships(session, user.id)
    if memberships:
        return memberships[0][2].id
    # A user with no organization gets a personal workspace (e.g. after being removed from all orgs).
    org = await create_organization(session, name=f"{user.display_name or 'Personal'} workspace", owner=user,
                                    personal=True)
    user.default_tenant_id = org.id
    return org.id


async def _start_session(session: AsyncSession, user: User, tenant_id: uuid.UUID, client: ClientInfo, *,
                         auth_method: str, mfa_verified: bool) -> IssuedTokens:
    settings = get_settings()
    auth_session = AuthSession(
        user_id=user.id, tenant_id=tenant_id, device_name=client.device_name,
        user_agent=(client.user_agent or "")[:500],
        ip_address=client.ip, auth_method=auth_method, mfa_verified=mfa_verified,
        expires_at=utcnow() + timedelta(seconds=settings.refresh_token_ttl_seconds),
    )
    session.add(auth_session)
    await session.flush()
    return await _issue_tokens(session, user, auth_session, parent_id=None)


async def _issue_tokens(session: AsyncSession, user: User, auth_session: AuthSession, *,
                        parent_id: uuid.UUID | None) -> IssuedTokens:
    settings = get_settings()
    refresh_plain = generate_opaque_token(48)
    refresh = RefreshToken(
        session_id=auth_session.id, token_hash=hash_token(refresh_plain), parent_id=parent_id,
        expires_at=min(ensure_aware(auth_session.expires_at),
                       utcnow() + timedelta(seconds=settings.refresh_token_ttl_seconds)),
    )
    session.add(refresh)
    access, _ = create_access_token(user.id, auth_session.id, auth_session.tenant_id, settings)
    response = TokenResponse(
        access_token=access, expires_in=settings.access_token_ttl_seconds, refresh_token=refresh_plain,
        session_id=auth_session.id, tenant_id=auth_session.tenant_id, user_id=user.id,
    )
    return IssuedTokens(response=response, refresh_token=refresh_plain)


# ------------------------------------------------------------------ refresh
async def refresh(session: AsyncSession, *, refresh_token: str, client: ClientInfo) -> IssuedTokens:
    set_system_scope(session)  # unauthenticated flow: trusted system code, no caller tenant yet
    now = utcnow()
    token = (
        await session.execute(
            select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)).with_for_update()
        )
    ).scalar_one_or_none()
    if token is None:
        raise Unauthorized("Invalid refresh token", code="invalid_refresh_token")
    auth_session = await session.get(AuthSession, token.session_id, with_for_update=True)
    if auth_session is None:
        raise Unauthorized("Invalid refresh token", code="invalid_refresh_token")

    if token.used_at is not None or token.revoked_at is not None:
        # Reuse of a rotated token: revoke the entire session family.
        await _revoke_session(session, auth_session, reason="refresh_token_reuse")
        audit.record(session, category=AuditCategory.SECURITY, action="auth.refresh.reuse_detected",
                     status="denied", tenant_id=auth_session.tenant_id, user_id=auth_session.user_id,
                     ip=client.ip, user_agent=client.user_agent,
                     metadata={"session_id": str(auth_session.id)})
        await session.commit()
        raise Unauthorized("Refresh token reuse detected; session revoked", code="refresh_token_reused")

    if ensure_aware(token.expires_at) <= now or auth_session.revoked_at is not None \
            or ensure_aware(auth_session.expires_at) <= now:
        raise Unauthorized("Session expired", code="session_expired")

    user = await session.get(User, auth_session.user_id)
    if user is None or user.status != UserStatus.ACTIVE:
        raise Unauthorized("Session is no longer valid", code="session_invalid")
    if await org_repo.get_active_membership(session, user.id, auth_session.tenant_id) is None:
        raise Unauthorized("Organization membership is no longer active", code="session_invalid")

    token.used_at = now
    auth_session.last_seen_at = now
    if client.ip:
        auth_session.ip_address = client.ip
    issued = await _issue_tokens(session, user, auth_session, parent_id=token.id)
    await session.commit()
    return issued


# ------------------------------------------------------------------ sessions
async def _revoke_session(session: AsyncSession, auth_session: AuthSession, *, reason: str) -> None:
    now = utcnow()
    if auth_session.revoked_at is None:
        auth_session.revoked_at = now
        auth_session.revoke_reason = reason
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.session_id == auth_session.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def logout(session: AsyncSession, ctx: RequestContext) -> None:
    if ctx.session_id is None:
        return
    auth_session = await session.get(AuthSession, ctx.session_id)
    if auth_session is not None:
        await _revoke_session(session, auth_session, reason="logout")
        audit.record(session, ctx=ctx, category=AuditCategory.AUTH, action="auth.logout")
        await session.commit()


async def revoke_all_sessions(session: AsyncSession, user_id: uuid.UUID, *, reason: str,
                              except_session: uuid.UUID | None = None) -> int:
    rows = (await session.execute(
        select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    )).scalars().all()
    count = 0
    for row in rows:
        if except_session is not None and row.id == except_session:
            continue
        await _revoke_session(session, row, reason=reason)
        count += 1
    return count


async def revoke_user_sessions_in_tenant(session: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID, *,
                                         reason: str) -> None:
    rows = (await session.execute(
        select(AuthSession).where(AuthSession.user_id == user_id, AuthSession.tenant_id == tenant_id,
                                  AuthSession.revoked_at.is_(None))
    )).scalars().all()
    for row in rows:
        await _revoke_session(session, row, reason=reason)


async def list_sessions(session: AsyncSession, ctx: RequestContext) -> list[AuthSession]:
    return list((await session.execute(
        select(AuthSession).where(AuthSession.user_id == ctx.user_id).order_by(AuthSession.created_at.desc())
        .limit(100)
    )).scalars().all())


async def revoke_session_by_id(session: AsyncSession, ctx: RequestContext, session_id: uuid.UUID) -> None:
    auth_session = await session.get(AuthSession, session_id)
    if auth_session is None or auth_session.user_id != ctx.user_id:
        raise NotFound("Session not found")
    await _revoke_session(session, auth_session, reason="user_revoked")
    audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="auth.session.revoke",
                 resource_type="session", resource_id=session_id)
    await session.commit()


async def switch_organization(session: AsyncSession, ctx: RequestContext, organization_id: uuid.UUID) -> str:
    if await org_repo.get_active_membership(session, ctx.user_id, organization_id) is None:
        raise Forbidden("You are not a member of that organization")
    auth_session = await session.get(AuthSession, ctx.session_id) if ctx.session_id else None
    if auth_session is None or auth_session.revoked_at is not None:
        raise Unauthorized("Session is no longer valid")
    auth_session.tenant_id = organization_id
    user = await session.get(User, ctx.user_id)
    if user is not None:
        user.default_tenant_id = organization_id
    access, _ = create_access_token(ctx.user_id, auth_session.id, organization_id)
    audit.record(session, ctx=ctx, category=AuditCategory.AUTH, action="auth.switch_organization",
                 tenant_id=organization_id)
    await session.commit()
    return access


async def change_password(session: AsyncSession, ctx: RequestContext, current: str, new: str) -> None:
    user = await session.get(User, ctx.user_id)
    if user is None or not verify_password(current, user.password_hash):
        raise Unauthorized("Invalid credentials", code="invalid_credentials")
    user.password_hash = hash_password(new)
    revoked = await revoke_all_sessions(session, user.id, reason="password_changed", except_session=ctx.session_id)
    audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="auth.password.change",
                 metadata={"other_sessions_revoked": revoked})
    await session.commit()


# ------------------------------------------------------------------ access-token authentication
@dataclass(slots=True)
class AuthenticatedPrincipal:
    user: User
    auth_session: AuthSession
    role: str
    permissions: frozenset[str]


async def authenticate_access_token(session: AsyncSession, token: str, *, expected_type: str = "access"
                                    ) -> AuthenticatedPrincipal:
    claims = decode_access_token(token, expected_type=expected_type)
    auth_session = await session.get(AuthSession, claims.session_id)
    now = utcnow()
    if auth_session is None or auth_session.revoked_at is not None or ensure_aware(auth_session.expires_at) <= now:
        raise Unauthorized("Session revoked or expired", code="session_invalid")
    if auth_session.user_id != claims.user_id or auth_session.tenant_id != claims.tenant_id:
        raise Unauthorized("Token does not match session", code="invalid_token")
    user = await session.get(User, claims.user_id)
    if user is None or user.status != UserStatus.ACTIVE or user.deleted_at is not None:
        raise Unauthorized("Account is not active", code="account_inactive")
    membership = await org_repo.get_active_membership(session, user.id, claims.tenant_id)
    if membership is None:
        raise Unauthorized("Organization membership is not active", code="membership_inactive")
    _, role, _ = membership
    permissions = await org_repo.role_permissions(session, role.id)
    # Touch last_seen at most once a minute to avoid write amplification.
    if (now - ensure_aware(auth_session.last_seen_at)).total_seconds() > 60:
        await session.execute(update(AuthSession).where(AuthSession.id == auth_session.id)
                              .values(last_seen_at=now))
        await session.commit()
    return AuthenticatedPrincipal(user=user, auth_session=auth_session, role=role.name, permissions=permissions)


def create_stream_token(ctx: RequestContext) -> tuple[str, int]:
    """Short-lived token for EventSource clients that cannot send Authorization headers."""
    settings = get_settings()
    if ctx.session_id is None:
        raise Unauthorized("A user session is required")
    token, _ = create_access_token(ctx.user_id, ctx.session_id, ctx.tenant_id, settings,
                                   ttl_seconds=settings.stream_token_ttl_seconds, token_type="stream")
    return token, settings.stream_token_ttl_seconds


# ------------------------------------------------------------------ MFA (TOTP)
async def enroll_mfa(session: AsyncSession, ctx: RequestContext) -> tuple[MfaFactor, str, str]:
    user = await session.get(User, ctx.user_id)
    if user is None:
        raise NotFound("User not found")
    secret = totp.generate_secret()
    factor = MfaFactor(user_id=user.id, secret_encrypted=get_key_manager().encrypt(secret))
    session.add(factor)
    await session.flush()
    uri = totp.provisioning_uri(secret, user.email, get_settings().app_name)
    await session.commit()
    return factor, secret, uri


async def confirm_mfa(session: AsyncSession, ctx: RequestContext, factor_id: uuid.UUID, code: str) -> None:
    factor = await session.get(MfaFactor, factor_id)
    if factor is None or factor.user_id != ctx.user_id:
        raise NotFound("MFA factor not found")
    secret = get_key_manager().decrypt(factor.secret_encrypted)
    step = totp.verify(secret, code, last_used_step=factor.last_used_step)
    if step is None:
        raise ValidationFailed("Invalid verification code")
    factor.confirmed_at = utcnow()
    factor.last_used_step = step
    user = await session.get(User, ctx.user_id)
    assert user is not None
    user.mfa_enabled = True
    audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="auth.mfa.enabled")
    await session.commit()


async def disable_mfa(session: AsyncSession, ctx: RequestContext, code: str) -> None:
    user = await session.get(User, ctx.user_id)
    if user is None or not user.mfa_enabled:
        raise Conflict("MFA is not enabled")
    if not await verify_mfa_code(session, user, code):
        raise ValidationFailed("Invalid verification code")
    factors = (await session.execute(select(MfaFactor).where(MfaFactor.user_id == user.id))).scalars().all()
    for factor in factors:
        await session.delete(factor)
    user.mfa_enabled = False
    audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="auth.mfa.disabled")
    await session.commit()


async def verify_mfa_code(session: AsyncSession, user: User, code: str) -> bool:
    factors = (await session.execute(
        select(MfaFactor).where(MfaFactor.user_id == user.id, MfaFactor.confirmed_at.is_not(None))
        .with_for_update()
    )).scalars().all()
    key_manager = get_key_manager()
    for factor in factors:
        step = totp.verify(key_manager.decrypt(factor.secret_encrypted), code, last_used_step=factor.last_used_step)
        if step is not None:
            factor.last_used_step = step  # prevents replay of the same code
            return True
    return False


# ------------------------------------------------------------------ external identity login
async def login_with_external_identity(session: AsyncSession, *, provider: str, subject: str, email: str,
                                       email_verified: bool, display_name: str | None,
                                       client: ClientInfo) -> IssuedTokens:
    set_system_scope(session)  # unauthenticated flow: trusted system code, no caller tenant yet
    from app.users.models import UserIdentity

    identity = (await session.execute(
        select(UserIdentity).where(UserIdentity.provider == provider, UserIdentity.provider_subject == subject)
    )).scalar_one_or_none()
    if identity is not None:
        user = await session.get(User, identity.user_id)
    else:
        if not email_verified:
            raise Unauthorized("The identity provider did not verify this e-mail address",
                               code="email_not_verified")
        user = await get_user_by_email(session, email)
        if user is None:
            user = User(email=email.lower(), email_verified=True, display_name=display_name)
            session.add(user)
            await session.flush()
            org = await create_organization(session, name=f"{display_name or 'Personal'} workspace", owner=user,
                                            personal=True)
            user.default_tenant_id = org.id
        session.add(UserIdentity(user_id=user.id, provider=provider, provider_subject=subject, email=email))
    if user is None or user.status != UserStatus.ACTIVE:
        raise Unauthorized("Account is not active", code="account_inactive")
    if user.mfa_enabled:
        # External login does not bypass MFA: require the password+MFA flow.
        raise Unauthorized("Multi-factor authentication required; sign in with your password and code",
                           code="mfa_required")
    user.last_login_at = utcnow()
    tenant_id = await _resolve_login_tenant(session, user)
    tokens = await _start_session(session, user, tenant_id, client, auth_method=provider, mfa_verified=False)
    audit.record(session, category=AuditCategory.AUTH, action=f"auth.login.{provider}", tenant_id=tenant_id,
                 user_id=user.id, actor_type="user", ip=client.ip, user_agent=client.user_agent)
    await session.commit()
    return tokens
