from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, SoftDeleteMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class UserStatus:
    ACTIVE = "active"
    DISABLED = "disabled"
    DELETION_PENDING = "deletion_pending"
    DELETED = "deleted"


class User(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionedMixin, Base):
    """A person. Global (not tenant-scoped): a user can belong to several organizations."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    locale: Mapped[str] = mapped_column(String(16), nullable=False, default="en")
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=UserStatus.ACTIVE)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    failed_login_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(nullable=True)
    mfa_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_login_at: Mapped[datetime | None] = mapped_column(nullable=True)
    default_tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="SET NULL", use_alter=True), nullable=True
    )

    __table_args__ = (Index("uq_users_email_lower", func.lower(email), unique=True),)


class UserIdentity(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """External login identity (e.g. Google ``sub``) linked to a user."""

    __tablename__ = "user_identities"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_subject: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)

    __table_args__ = (UniqueConstraint("provider", "provider_subject"),)
