from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class ConnectionStatus:
    CONNECTED = "connected"
    EXPIRED = "expired"
    REVOKED = "revoked"
    INSUFFICIENT_SCOPE = "insufficient_scope"
    TEMPORARILY_UNAVAILABLE = "temporarily_unavailable"
    DISCONNECTED = "disconnected"


class OAuthConnection(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, Base):
    """A user's connected provider account. Tokens are encrypted at rest and never leave
    the backend (not returned by any API)."""

    __tablename__ = "oauth_connections"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    account_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default=ConnectionStatus.CONNECTED)
    access_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    refresh_token_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_refreshed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    last_error_at: Mapped[datetime | None] = mapped_column(nullable=True)
    connected_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    disconnected_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "provider", "provider_account_id"),
        Index("ix_oauth_connections_user_provider", "tenant_id", "user_id", "provider"),
    )


class OAuthScope(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    __tablename__ = "oauth_scopes"

    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("oauth_connections.id", ondelete="CASCADE"),
                                                     nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(300), nullable=False)
    granted_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (UniqueConstraint("connection_id", "scope"),)
