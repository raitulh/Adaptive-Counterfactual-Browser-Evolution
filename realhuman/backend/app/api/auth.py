"""Dashboard accounts: signup, login, logout, current session."""

from __future__ import annotations

from fastapi import APIRouter, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    AppSettings,
    CurrentUser,
    DbSession,
    Now,
    TrustedOrigin,
    enforce_rate_limit,
    rate_limit,
)
from app.errors import ApiError
from app.models import Project, ProjectSettings, User
from app.schemas.auth import AuthSessionOut, LoginIn, SignupIn
from app.security.api_keys import generate_site_key
from app.security.auth import (
    clear_auth_cookie,
    create_auth_session,
    hash_password,
    revoke_auth_session,
    set_auth_cookie,
    verify_password,
)

router = APIRouter(prefix="/v1/auth", tags=["auth"])

AUTH_LIMIT = rate_limit("auth", "rate_limit_auth_per_minute", 60)


def workspace_name_for(email: str) -> str:
    return f"{email.split('@', 1)[0][:60]}'s workspace"


@router.post(
    "/signup",
    status_code=201,
    response_model=AuthSessionOut,
    dependencies=[TrustedOrigin, AUTH_LIMIT],
)
def signup(
    body: SignupIn, response: Response, db: DbSession, settings: AppSettings, now: Now
) -> AuthSessionOut:
    if db.scalar(select(User.id).where(User.email == body.email)):
        raise ApiError(409, "VALIDATION_ERROR", "An account with this email already exists.")
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        workspace_name=workspace_name_for(body.email),
        created_at=now,
        last_login_at=now,
    )
    project = Project(name="Default project", site_key=generate_site_key(), created_at=now)
    project.settings = ProjectSettings(updated_at=now)
    user.projects.append(project)
    db.add(user)
    try:
        db.flush()
    except IntegrityError as error:  # concurrent signup with the same email
        db.rollback()
        raise ApiError(
            409, "VALIDATION_ERROR", "An account with this email already exists."
        ) from error
    token = create_auth_session(db, user, settings, now)
    db.commit()
    set_auth_cookie(response, token, settings)
    return AuthSessionOut(email=user.email, workspace=user.workspace_name)


@router.post("/login", response_model=AuthSessionOut, dependencies=[TrustedOrigin, AUTH_LIMIT])
def login(
    body: LoginIn,
    request: Request,
    response: Response,
    db: DbSession,
    settings: AppSettings,
    now: Now,
) -> AuthSessionOut:
    # Also limit per account, so one account can't be brute-forced from many IPs.
    enforce_rate_limit(request, f"login:{body.email}", settings.rate_limit_auth_per_minute * 2, 60)
    user = db.scalar(select(User).where(User.email == body.email))
    if not verify_password(user, body.password) or user is None:
        raise ApiError(401, "INVALID_CREDENTIALS")
    user.last_login_at = now
    token = create_auth_session(db, user, settings, now)
    db.commit()
    set_auth_cookie(response, token, settings)
    return AuthSessionOut(email=user.email, workspace=user.workspace_name)


@router.post("/logout", status_code=204, dependencies=[TrustedOrigin])
def logout(request: Request, db: DbSession, settings: AppSettings) -> Response:
    token = request.cookies.get(settings.cookie_name)
    if token:
        revoke_auth_session(db, token)
    response = Response(status_code=204)
    clear_auth_cookie(response, settings)
    return response


@router.get("/me", response_model=AuthSessionOut)
def me(user: CurrentUser) -> AuthSessionOut:
    return AuthSessionOut(email=user.email, workspace=user.workspace_name)
