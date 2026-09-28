"""FastAPI dependencies: DB session, authenticated context, RBAC and rate limits."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable, Coroutine
from typing import Annotated, Any

from fastapi import Depends, Header, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.common.context import RequestContext
from app.core.config import get_settings
from app.core.database import get_session_factory, set_tenant_scope
from app.core.exceptions import Forbidden, Unauthorized
from app.core.logging import tenant_id_var, user_id_var
from app.core.middleware import client_ip
from app.security.ratelimit import get_rate_limiter


async def get_db() -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        try:
            yield session
        finally:
            if session.in_transaction():
                await session.rollback()


DbSession = Annotated[AsyncSession, Depends(get_db)]


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        token = header[7:].strip()
        return token or None
    return None


async def _build_context(request: Request, db: AsyncSession, token: str, *, token_type: str) -> RequestContext:
    principal = await auth_service.authenticate_access_token(db, token, expected_type=token_type)
    ctx = RequestContext(
        user_id=principal.user.id,
        tenant_id=principal.auth_session.tenant_id,
        role=principal.role,
        permissions=principal.permissions,
        session_id=principal.auth_session.id,
        is_platform_admin=principal.user.is_platform_admin,
        request_id=getattr(request.state, "request_id", None) or request.scope.get("state", {}).get("request_id"),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300] or None,
        timezone=principal.user.timezone,
        email=principal.user.email,
    )
    # From here on every ORM query on this session is confined to the caller's tenant.
    set_tenant_scope(db, ctx.tenant_id)
    tenant_id_var.set(str(ctx.tenant_id))
    user_id_var.set(str(ctx.user_id))
    await _enforce_principal_rate_limits(ctx)
    return ctx


async def _enforce_principal_rate_limits(ctx: RequestContext) -> None:
    settings = get_settings()
    limiter = get_rate_limiter()
    await limiter.enforce("user", str(ctx.user_id), settings.rate_limit_user_per_minute)
    await limiter.enforce("tenant", str(ctx.tenant_id), settings.rate_limit_tenant_per_minute)


async def get_ctx(request: Request, db: DbSession) -> RequestContext:
    token = _bearer(request)
    if token is None:
        raise Unauthorized("Missing bearer token")
    return await _build_context(request, db, token, token_type="access")


async def get_stream_ctx(request: Request, db: DbSession,
                         access_token: Annotated[str | None, Query(alias="access_token", max_length=2048)] = None
                         ) -> RequestContext:
    """SSE endpoints accept a Bearer header, or a short-lived *stream* token as a query
    parameter (EventSource cannot set headers). Full access tokens are never accepted
    in URLs, where they could leak into logs."""
    token = _bearer(request)
    if token is not None:
        return await _build_context(request, db, token, token_type="access")
    if access_token:
        return await _build_context(request, db, access_token, token_type="stream")
    raise Unauthorized("Missing credentials")


Ctx = Annotated[RequestContext, Depends(get_ctx)]


def require(*permissions: str) -> Callable[..., Coroutine[Any, Any, RequestContext]]:
    async def _dep(ctx: Ctx) -> RequestContext:
        ctx.require(*permissions)
        return ctx

    return _dep


async def require_platform_admin(ctx: Ctx) -> RequestContext:
    if not ctx.is_platform_admin:
        raise Forbidden("Platform administrator privileges required")
    return ctx


def user_rate_limit(scope: str, limit_attr: str, window_seconds: int = 60
                    ) -> Callable[..., Coroutine[Any, Any, None]]:
    """Route-specific per-user limit. ``limit_attr`` names a Settings attribute."""

    async def _dep(ctx: Ctx) -> None:
        limit = int(getattr(get_settings(), limit_attr))
        await get_rate_limiter().enforce(f"route:{scope}", str(ctx.user_id), limit, window_seconds)

    return _dep


def ip_route_rate_limit(scope: str, limit_attr: str, window_seconds: int = 60, *,
                        fail_open: bool | None = None) -> Callable[..., Coroutine[Any, Any, None]]:
    """Route-specific per-IP limit for unauthenticated endpoints (login, register, refresh)."""

    async def _dep(request: Request) -> None:
        limit = int(getattr(get_settings(), limit_attr))
        await get_rate_limiter().enforce(f"route:{scope}", client_ip(request), limit, window_seconds,
                                         fail_open=fail_open)

    return _dep


async def ip_rate_limit(request: Request) -> None:
    await get_rate_limiter().enforce("ip", client_ip(request), get_settings().rate_limit_ip_per_minute)


IdempotencyKeyHeader = Annotated[
    str | None,
    Header(alias="Idempotency-Key", min_length=8, max_length=128, pattern=r"^[A-Za-z0-9_\-:.]+$",
           description="Client-generated key; retries with the same key return the original result."),
]
