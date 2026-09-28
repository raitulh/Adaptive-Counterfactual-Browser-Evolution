"""Credential primitives: password hashing, access tokens, opaque token hashing."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.common.time import utcnow
from app.core.config import Settings, get_settings
from app.core.exceptions import Unauthorized

# Argon2id with OWASP-recommended parameters (m=19 MiB, t=2, p=1).
_hasher = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
# Used to equalise timing when a login targets a non-existent account.
_DUMMY_HASH = _hasher.hash("timing-equaliser-not-a-real-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def password_needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)


def hash_token(token: str) -> str:
    """Opaque tokens (refresh tokens, API keys) are stored only as SHA-256 digests."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


def generate_opaque_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hmac_sign(secret: str, message: str) -> str:
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


@dataclass(frozen=True, slots=True)
class AccessTokenClaims:
    user_id: uuid.UUID
    session_id: uuid.UUID
    tenant_id: uuid.UUID
    jti: str
    expires_at: datetime
    token_type: str = "access"


def create_access_token(user_id: uuid.UUID, session_id: uuid.UUID, tenant_id: uuid.UUID,
                        settings: Settings | None = None, *, ttl_seconds: int | None = None,
                        token_type: str = "access",  # noqa: S107 - token kind, not a secret
                        extra: dict[str, Any] | None = None) -> tuple[str, datetime]:
    settings = settings or get_settings()
    now = utcnow()
    expires = now + timedelta(seconds=ttl_seconds or settings.access_token_ttl_seconds)
    payload: dict[str, Any] = {
        "sub": str(user_id),
        "sid": str(session_id),
        "tid": str(tenant_id),
        "typ": token_type,
        "jti": secrets.token_hex(12),
        "iat": int(now.timestamp()),
        "nbf": int(now.timestamp()),
        "exp": int(expires.timestamp()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, settings.jwt_secret.get_secret_value(), algorithm=settings.jwt_algorithm)
    return token, expires


def decode_access_token(token: str, settings: Settings | None = None, *, expected_type: str = "access"
                        ) -> AccessTokenClaims:
    settings = settings or get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret.get_secret_value(),
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "iat", "sub", "sid", "tid", "typ", "jti"]},
            leeway=5,
        )
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("Access token expired", code="token_expired") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid access token", code="invalid_token") from exc
    if payload.get("typ") != expected_type:
        raise Unauthorized("Invalid token type", code="invalid_token")
    try:
        return AccessTokenClaims(
            user_id=uuid.UUID(payload["sub"]),
            session_id=uuid.UUID(payload["sid"]),
            tenant_id=uuid.UUID(payload["tid"]),
            jti=payload["jti"],
            expires_at=datetime.fromtimestamp(payload["exp"], tz=utcnow().tzinfo),
            token_type=payload["typ"],
        )
    except (ValueError, KeyError) as exc:
        raise Unauthorized("Invalid access token", code="invalid_token") from exc
