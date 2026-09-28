from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin, UUIDPrimaryKeyMixin


class AuthSession(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A signed-in device/session. Revoking it invalidates its access and refresh tokens."""

    __tablename__ = "auth_sessions"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    device_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(500), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    auth_method: Mapped[str] = mapped_column(String(30), nullable=False, default="password")
    mfa_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_seen_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)
    revoke_reason: Mapped[str | None] = mapped_column(String(100), nullable=True)

    __table_args__ = (
        Index("ix_auth_sessions_user_active", "user_id", postgresql_where=text("revoked_at IS NULL")),
    )


class RefreshToken(UUIDPrimaryKeyMixin, Base):
    """Rotating refresh tokens. Each use issues a child and marks the parent used; presenting
    an already-used token is treated as theft and revokes the whole session (family)."""

    __tablename__ = "refresh_tokens"

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("auth_sessions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("refresh_tokens.id", ondelete="SET NULL"))
    issued_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(nullable=True)


class MfaFactor(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """TOTP factor (RFC 6238). The shared secret is encrypted at rest."""

    __tablename__ = "mfa_factors"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    factor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="totp")
    secret_encrypted: Mapped[str] = mapped_column(String(500), nullable=False)
    confirmed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_used_step: Mapped[int | None] = mapped_column(Integer, nullable=True)
