from __future__ import annotations

import secrets
import uuid

from fastapi import APIRouter, Depends, Query, Request, Response, status

from app.api.dependencies import Ctx, DbSession, ip_route_rate_limit
from app.auth import service
from app.auth.schemas import (
    ChangePasswordRequest,
    LoginRequest,
    MfaCodeRequest,
    MfaEnrollResponse,
    OAuthStartResponse,
    RefreshRequest,
    RegisterRequest,
    SessionOut,
    StreamTokenResponse,
    SwitchOrganizationRequest,
    TokenResponse,
)
from app.auth.service import ClientInfo, IssuedTokens
from app.core.config import get_settings
from app.core.exceptions import Unauthorized
from app.core.middleware import client_ip
from app.core.security import constant_time_equals
from app.integrations.google.oauth import SCOPES_OPENID, GoogleOAuthClient, OAuthStateStore, pkce_pair
from app.security.ratelimit import get_rate_limiter

router = APIRouter(prefix="/auth", tags=["auth"])

REFRESH_COOKIE = "agentos_refresh"
CSRF_COOKIE = "agentos_csrf"


def _client(request: Request, device_name: str | None = None) -> ClientInfo:
    return ClientInfo(ip=client_ip(request), user_agent=request.headers.get("user-agent"), device_name=device_name)


def _deliver(response: Response, issued: IssuedTokens, delivery: str) -> TokenResponse:
    if delivery != "cookie":
        return issued.response
    settings = get_settings()
    cookie_path = f"{settings.api_prefix}/auth"
    response.set_cookie(REFRESH_COOKIE, issued.refresh_token, max_age=settings.refresh_token_ttl_seconds,
                        httponly=True, secure=settings.cookie_secure, samesite="strict", path=cookie_path,
                        domain=settings.cookie_domain)
    # Double-submit CSRF token: readable by the SPA, must be echoed in X-CSRF-Token on refresh.
    response.set_cookie(CSRF_COOKIE, secrets.token_urlsafe(24), max_age=settings.refresh_token_ttl_seconds,
                        httponly=False, secure=settings.cookie_secure, samesite="strict", path="/",
                        domain=settings.cookie_domain)
    return issued.response.model_copy(update={"refresh_token": None})


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED,
             summary="Create an account and a personal organization",
             dependencies=[Depends(ip_route_rate_limit("auth_register", "rate_limit_auth_per_minute"))],
             responses={409: {"description": "Registration failed"}, 422: {"description": "Invalid input"}})
async def register(body: RegisterRequest, request: Request, response: Response, db: DbSession) -> TokenResponse:
    issued = await service.register(db, email=body.email, password=body.password, display_name=body.display_name,
                                    organization_name=body.organization_name, timezone=body.timezone,
                                    client=_client(request))
    return issued.response


@router.post("/login", response_model=TokenResponse, summary="Sign in with e-mail and password",
             dependencies=[Depends(ip_route_rate_limit("auth_login", "rate_limit_auth_per_minute"))],
             responses={401: {"description": "Invalid credentials or MFA required"}, 429: {"description": "Rate limited"}})
async def login(body: LoginRequest, request: Request, response: Response, db: DbSession) -> TokenResponse:
    settings = get_settings()
    # Per-account throttle in addition to the per-IP limit (credential stuffing across IPs).
    await get_rate_limiter().enforce("auth_login_account", body.email.lower(), settings.rate_limit_auth_per_minute)
    issued = await service.login(db, email=body.email, password=body.password, mfa_code=body.mfa_code,
                                 client=_client(request, body.device_name))
    return _deliver(response, issued, body.token_delivery)


@router.post("/refresh", response_model=TokenResponse, summary="Rotate the refresh token and get a new access token",
             dependencies=[Depends(ip_route_rate_limit("auth_refresh", "rate_limit_user_per_minute"))],
             responses={401: {"description": "Invalid, expired or reused refresh token"}})
async def refresh(request: Request, response: Response, db: DbSession, body: RefreshRequest | None = None
                  ) -> TokenResponse:
    body = body or RefreshRequest()
    token = body.refresh_token
    delivery = body.token_delivery
    if token is None:
        token = request.cookies.get(REFRESH_COOKIE)
        if token is None:
            raise Unauthorized("Missing refresh token")
        csrf_cookie = request.cookies.get(CSRF_COOKIE, "")
        csrf_header = request.headers.get("x-csrf-token", "")
        if not csrf_cookie or not csrf_header or not constant_time_equals(csrf_cookie, csrf_header):
            raise Unauthorized("CSRF validation failed", code="csrf_failed")
        delivery = "cookie"
    issued = await service.refresh(db, refresh_token=token, client=_client(request))
    return _deliver(response, issued, delivery)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke the current session")
async def logout(ctx: Ctx, db: DbSession, response: Response) -> Response:
    await service.logout(db, ctx)
    settings = get_settings()
    response.delete_cookie(REFRESH_COOKIE, path=f"{settings.api_prefix}/auth")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.post("/logout-all", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke all sessions of the user")
async def logout_all(ctx: Ctx, db: DbSession) -> Response:
    await service.revoke_all_sessions(db, ctx.user_id, reason="logout_all")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/sessions", response_model=list[SessionOut], summary="List the user's sessions/devices")
async def list_sessions(ctx: Ctx, db: DbSession) -> list[SessionOut]:
    rows = await service.list_sessions(db, ctx)
    return [SessionOut.model_validate(r).model_copy(update={"current": r.id == ctx.session_id}) for r in rows]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Revoke a session")
async def revoke_session(session_id: uuid.UUID, ctx: Ctx, db: DbSession) -> Response:
    await service.revoke_session_by_id(db, ctx, session_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/switch-organization", response_model=TokenResponse, summary="Switch the active organization")
async def switch_org(body: SwitchOrganizationRequest, ctx: Ctx, db: DbSession) -> TokenResponse:
    access = await service.switch_organization(db, ctx, body.organization_id)
    assert ctx.session_id is not None
    return TokenResponse(access_token=access, expires_in=get_settings().access_token_ttl_seconds,
                         session_id=ctx.session_id, tenant_id=body.organization_id, user_id=ctx.user_id)


@router.post("/password/change", status_code=status.HTTP_204_NO_CONTENT,
             summary="Change password (revokes other sessions)")
async def change_password(body: ChangePasswordRequest, ctx: Ctx, db: DbSession) -> Response:
    await service.change_password(db, ctx, body.current_password, body.new_password)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/mfa/enroll", response_model=MfaEnrollResponse, summary="Start TOTP MFA enrollment")
async def mfa_enroll(ctx: Ctx, db: DbSession) -> MfaEnrollResponse:
    factor, secret, uri = await service.enroll_mfa(db, ctx)
    return MfaEnrollResponse(factor_id=factor.id, secret=secret, otpauth_uri=uri)


@router.post("/mfa/{factor_id}/confirm", status_code=status.HTTP_204_NO_CONTENT, summary="Confirm TOTP enrollment")
async def mfa_confirm(factor_id: uuid.UUID, body: MfaCodeRequest, ctx: Ctx, db: DbSession) -> Response:
    await service.confirm_mfa(db, ctx, factor_id, body.code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/mfa/disable", status_code=status.HTTP_204_NO_CONTENT, summary="Disable MFA (requires a valid code)")
async def mfa_disable(body: MfaCodeRequest, ctx: Ctx, db: DbSession) -> Response:
    await service.disable_mfa(db, ctx, body.code)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/stream-token", response_model=StreamTokenResponse,
             summary="Short-lived token for EventSource (SSE) connections")
async def stream_token(ctx: Ctx) -> StreamTokenResponse:
    token, ttl = service.create_stream_token(ctx)
    return StreamTokenResponse(token=token, expires_in=ttl)


# ------------------------------------------------------------------ Google sign-in
@router.get("/oauth/google/start", response_model=OAuthStartResponse, summary="Begin Sign in with Google",
            dependencies=[Depends(ip_route_rate_limit("auth_oauth", "rate_limit_auth_per_minute"))])
async def google_login_start() -> OAuthStartResponse:
    settings = get_settings()
    verifier, challenge = pkce_pair()
    nonce = secrets.token_urlsafe(16)
    state = await OAuthStateStore().create({"purpose": "login", "verifier": verifier, "nonce": nonce})
    url = GoogleOAuthClient(settings).authorization_url(
        scopes=SCOPES_OPENID, state=state, code_challenge=challenge, redirect_uri=settings.google_login_redirect_uri,
        nonce=nonce, offline=False)
    return OAuthStartResponse(authorization_url=url, state=state)


@router.get("/oauth/google/callback", response_model=TokenResponse, summary="Google sign-in callback",
            dependencies=[Depends(ip_route_rate_limit("auth_oauth", "rate_limit_auth_per_minute"))])
async def google_login_callback(request: Request, response: Response, db: DbSession,
                                code: str = Query(max_length=2048), state: str = Query(max_length=128),
                                token_delivery: str = Query("cookie", pattern="^(cookie|body)$")
                                ) -> TokenResponse:
    settings = get_settings()
    data = await OAuthStateStore().consume(state)
    if data.get("purpose") != "login":
        raise Unauthorized("OAuth state purpose mismatch")
    client = GoogleOAuthClient(settings)
    tokens = await client.exchange_code(code=code, code_verifier=data["verifier"],
                                        redirect_uri=settings.google_login_redirect_uri)
    if not tokens.id_token:
        raise Unauthorized("Google did not return an ID token")
    identity = await client.verify_id_token(tokens.id_token, nonce=data.get("nonce"))
    issued = await service.login_with_external_identity(
        db, provider="google", subject=identity.subject, email=identity.email,
        email_verified=identity.email_verified, display_name=identity.name, client=_client(request))
    return _deliver(response, issued, token_delivery)
