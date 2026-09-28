"""OAuth connection lifecycle: connect → callback → status/refresh → disconnect.

Tokens are encrypted with the KeyManager before they touch the database and are
never returned by any API. The OAuth ``state`` binds the callback to the
initiating user/tenant (single use, 10-minute TTL) and carries the PKCE verifier.
"""

from __future__ import annotations

import contextlib
import secrets
import uuid
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.crypto import get_key_manager
from app.core.exceptions import IntegrationError, NotFound, ValidationFailed
from app.integrations.google.oauth import (
    CAPABILITY_SCOPES,
    SCOPES_OPENID,
    GoogleIdentity,
    GoogleOAuthClient,
    GoogleTokenResponse,
    OAuthStateStore,
    expand_granted,
    google_oauth_client,
    pkce_pair,
)
from app.integrations.models import ConnectionStatus, OAuthConnection, OAuthScope
from app.integrations.schemas import ConnectionOut


def scopes_for(capabilities: list[str]) -> list[str]:
    unknown = [c for c in capabilities if c not in CAPABILITY_SCOPES]
    if unknown:
        raise ValidationFailed("Unknown capability", details={"unknown": unknown})
    scopes = list(SCOPES_OPENID)
    for cap in capabilities:
        scopes.extend(CAPABILITY_SCOPES[cap])
    return list(dict.fromkeys(scopes))


def capabilities_from_scopes(scopes: set[str]) -> list[str]:
    effective = expand_granted(scopes)
    return [cap for cap, needed in CAPABILITY_SCOPES.items() if all(s in effective for s in needed)]


async def start_google_connect(ctx: RequestContext, capabilities: list[str], login_hint: str | None,
                               client: GoogleOAuthClient | None = None) -> tuple[str, list[str]]:
    settings = get_settings()
    scopes = scopes_for(capabilities)
    verifier, challenge = pkce_pair()
    nonce = secrets.token_urlsafe(16)
    state = await OAuthStateStore().create({"purpose": "connect", "provider": "google", "verifier": verifier,
                                            "nonce": nonce, "user_id": str(ctx.user_id),
                                            "tenant_id": str(ctx.tenant_id), "scopes": scopes})
    url = (client or google_oauth_client(settings)).authorization_url(
        scopes=scopes, state=state, code_challenge=challenge, redirect_uri=settings.google_redirect_uri, nonce=nonce,
        login_hint=login_hint, offline=True)
    return url, scopes


async def complete_google_connect(session: AsyncSession, *, code: str, state: str,
                                  client: GoogleOAuthClient | None = None) -> OAuthConnection:
    settings = get_settings()
    data = await OAuthStateStore().consume(state)
    if data.get("purpose") != "connect" or data.get("provider") != "google":
        raise ValidationFailed("OAuth state purpose mismatch", code="oauth_state_invalid")
    tenant_id, user_id = uuid.UUID(data["tenant_id"]), uuid.UUID(data["user_id"])
    client = client or google_oauth_client(settings)
    tokens = await client.exchange_code(code=code, code_verifier=data["verifier"],
                                        redirect_uri=settings.google_redirect_uri)
    if not tokens.id_token:
        raise IntegrationError("Google did not return an ID token", provider="google")
    identity = await client.verify_id_token(tokens.id_token, nonce=data.get("nonce"))
    session.info["tenant_id"] = tenant_id
    conn = await store_google_connection(session, tenant_id=tenant_id, user_id=user_id, tokens=tokens,
                                         identity=identity)
    audit.record(session, category=AuditCategory.INTEGRATION, action="integration.google.connected",
                 tenant_id=tenant_id, user_id=user_id, actor_type="user", resource_type="oauth_connection",
                 resource_id=conn.id, metadata={"scopes": sorted(tokens.scope)})
    await session.commit()
    return conn


async def store_google_connection(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID,
                                  tokens: GoogleTokenResponse, identity: GoogleIdentity) -> OAuthConnection:
    """Upsert a connection with encrypted tokens and the *granted* (not requested) scopes."""
    km = get_key_manager()
    conn = (await session.execute(select(OAuthConnection).where(
        OAuthConnection.tenant_id == tenant_id, OAuthConnection.user_id == user_id,
        OAuthConnection.provider == "google", OAuthConnection.provider_account_id == identity.subject)
    )).scalar_one_or_none()
    if conn is None:
        conn = OAuthConnection(tenant_id=tenant_id, user_id=user_id, provider="google",
                               provider_account_id=identity.subject)
        session.add(conn)
    conn.account_email = identity.email
    conn.status = ConnectionStatus.CONNECTED
    conn.access_token_enc = km.encrypt(tokens.access_token)
    if tokens.refresh_token:
        conn.refresh_token_enc = km.encrypt(tokens.refresh_token)
    conn.token_expires_at = utcnow() + timedelta(seconds=tokens.expires_in)
    conn.last_refreshed_at = utcnow()
    conn.last_error_code = None
    conn.connected_at = utcnow()
    conn.disconnected_at = None
    await session.flush()
    await session.execute(delete(OAuthScope).where(OAuthScope.connection_id == conn.id))
    for scope in sorted(tokens.scope):
        session.add(OAuthScope(tenant_id=tenant_id, connection_id=conn.id, scope=scope))
    await session.flush()
    return conn


async def to_out(session: AsyncSession, conn: OAuthConnection) -> ConnectionOut:
    scopes = set((await session.execute(select(OAuthScope.scope).where(OAuthScope.connection_id == conn.id)
                                        )).scalars().all())
    out = ConnectionOut.model_validate(conn)
    out.scopes = sorted(scopes)
    out.capabilities = capabilities_from_scopes(scopes)
    return out


async def list_connections(session: AsyncSession, ctx: RequestContext) -> list[ConnectionOut]:
    rows = (await session.execute(select(OAuthConnection).where(OAuthConnection.user_id == ctx.user_id)
                                  .order_by(OAuthConnection.connected_at.desc()))).scalars().all()
    return [await to_out(session, r) for r in rows]


async def _owned(session: AsyncSession, ctx: RequestContext, connection_id: uuid.UUID) -> OAuthConnection:
    conn = await session.get(OAuthConnection, connection_id)
    if conn is None or conn.user_id != ctx.user_id:
        raise NotFound("Connection not found")
    return conn


async def disconnect(session: AsyncSession, ctx: RequestContext, connection_id: uuid.UUID,
                     client: GoogleOAuthClient | None = None) -> OAuthConnection:
    conn = await _owned(session, ctx, connection_id)
    token_enc = conn.refresh_token_enc or conn.access_token_enc
    conn.status = ConnectionStatus.DISCONNECTED
    conn.access_token_enc = None
    conn.refresh_token_enc = None
    conn.token_expires_at = None
    conn.disconnected_at = utcnow()
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="integration.google.disconnected",
                 resource_type="oauth_connection", resource_id=conn.id)
    await session.commit()
    if token_enc:
        # Best-effort revocation at the provider after local state is already safe.
        await (client or google_oauth_client()).revoke(get_key_manager().decrypt(token_enc))
    return conn


async def check_connection(session: AsyncSession, ctx: RequestContext, connection_id: uuid.UUID) -> OAuthConnection:
    """Force a token refresh to report the connection's real status (connected/expired/revoked/…)."""
    from app.tools.services import get_tool_services

    conn = await _owned(session, ctx, connection_id)
    await session.commit()
    with contextlib.suppress(IntegrationError):  # the vault records the resulting status on the connection
        await get_tool_services().vault.get_google_access(ctx.tenant_id, ctx.user_id, [], force_refresh=True)
    await session.refresh(conn)
    return conn
