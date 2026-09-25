"""Shared FastAPI dependencies."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ApiError
from app.models import ApiKey, Project, User
from app.security.api_keys import find_active_key
from app.security.auth import resolve_auth_session
from app.services.network import client_ip


def get_db(request: Request) -> Iterator[Session]:
    db = request.app.state.session_factory()
    try:
        yield db
    finally:
        db.close()


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_now(request: Request) -> datetime:
    return request.app.state.clock.now()


DbSession = Annotated[Session, Depends(get_db)]
AppSettings = Annotated[Settings, Depends(get_settings)]
Now = Annotated[datetime, Depends(get_now)]


def current_user(request: Request, db: DbSession, settings: AppSettings, now: Now) -> User:
    token = request.cookies.get(settings.cookie_name)
    if not token:
        raise ApiError(401, "UNAUTHORIZED")
    auth = resolve_auth_session(db, token, now)
    if auth is None:
        raise ApiError(401, "UNAUTHORIZED", "Your session has ended. Log in again.")
    return auth.user


CurrentUser = Annotated[User, Depends(current_user)]


def current_project(user: CurrentUser) -> Project:
    if not user.projects:
        raise ApiError(404, "NOT_FOUND", "No project exists for this account.")
    return user.projects[0]


CurrentProject = Annotated[Project, Depends(current_project)]


def require_trusted_origin(request: Request, settings: AppSettings) -> None:
    """
    CSRF defense in depth for cookie-authenticated writes: browsers always send
    `Origin` on cross-site POST/PUT/DELETE, so reject any origin we don't trust.
    Requests without `Origin` (server-side tools) carry no ambient cookie risk.
    """
    origin = request.headers.get("origin")
    if origin and origin.rstrip("/") not in settings.cors_origins:
        raise ApiError(403, "UNAUTHORIZED", "Requests from this origin are not allowed.")


TrustedOrigin = Depends(require_trusted_origin)


def enforce_rate_limit(request: Request, bucket: str, limit: int, window_seconds: float) -> None:
    settings: Settings = request.app.state.settings
    if not settings.rate_limit_enabled:
        return
    allowed, retry_after = request.app.state.rate_limiter.hit(bucket, limit, window_seconds)
    if not allowed:
        raise ApiError(429, "RATE_LIMITED", headers={"Retry-After": str(retry_after)})


def rate_limit(name: str, limit_setting: str, window_seconds: float):
    """Per-client-IP limit; the limit value is read from settings at request time."""

    def dependency(request: Request) -> None:
        settings: Settings = request.app.state.settings
        ip = client_ip(request, settings.trusted_proxy_count) or "unknown"
        enforce_rate_limit(
            request, f"{name}:{ip}", getattr(settings, limit_setting), window_seconds
        )

    return Depends(dependency)


def api_key_auth(request: Request, db: DbSession, settings: AppSettings, now: Now) -> ApiKey:
    header = request.headers.get("authorization", "")
    scheme, _, secret = header.partition(" ")
    if scheme.lower() != "bearer" or not secret.strip():
        raise ApiError(401, "UNAUTHORIZED", "Provide a secret API key as a Bearer token.")
    key = find_active_key(db, secret.strip())
    if key is None:
        raise ApiError(401, "UNAUTHORIZED", "Invalid or revoked API key.")
    enforce_rate_limit(request, f"verify:{key.id}", settings.rate_limit_verify_per_minute, 60)
    key.last_used_at = now
    db.commit()
    return key


AuthenticatedKey = Annotated[ApiKey, Depends(api_key_auth)]
