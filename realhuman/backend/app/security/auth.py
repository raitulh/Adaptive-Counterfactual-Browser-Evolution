"""Password hashing and dashboard login sessions (HttpOnly cookie)."""

from __future__ import annotations

from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import AuthSession, User
from app.security.crypto import random_token, sha256_hex

_hasher = PasswordHasher()  # Argon2id with library defaults
# Verified against when the email is unknown, so response timing doesn't reveal accounts.
_DUMMY_HASH = _hasher.hash("realhuman-timing-equalizer")

# Only refresh `last_seen_at` this often, to avoid a write on every request.
_TOUCH_INTERVAL = timedelta(minutes=5)


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(user: User | None, password: str) -> bool:
    """Constant-work password check. Upgrades the stored hash when parameters change."""
    try:
        _hasher.verify(user.password_hash if user else _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    if user is None:
        return False
    if _hasher.check_needs_rehash(user.password_hash):
        user.password_hash = _hasher.hash(password)
    return True


def create_auth_session(db: Session, user: User, settings: Settings, now: datetime) -> str:
    token = random_token(32)
    db.add(
        AuthSession(
            user_id=user.id,
            token_hash=sha256_hex(token),
            created_at=now,
            last_seen_at=now,
            expires_at=now + timedelta(hours=settings.auth_session_ttl_hours),
        )
    )
    return token


def resolve_auth_session(db: Session, token: str, now: datetime) -> AuthSession | None:
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == sha256_hex(token)))
    if session is None or session.expires_at <= now:
        return None
    if now - session.last_seen_at > _TOUCH_INTERVAL:
        session.last_seen_at = now
        db.commit()
    return session


def revoke_auth_session(db: Session, token: str) -> None:
    session = db.scalar(select(AuthSession).where(AuthSession.token_hash == sha256_hex(token)))
    if session is not None:
        db.delete(session)
        db.commit()


def set_auth_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=settings.auth_session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure_effective,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


def clear_auth_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=settings.cookie_name,
        httponly=True,
        secure=settings.cookie_secure_effective,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )
