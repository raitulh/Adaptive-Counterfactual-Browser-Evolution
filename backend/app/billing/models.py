from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class BillingAccount(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    __tablename__ = "billing_accounts"

    provider: Mapped[str] = mapped_column(String(30), nullable=False, default="none")
    provider_customer_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    billing_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")

    __table_args__ = (UniqueConstraint("tenant_id"),)


class Subscription(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, Base):
    __tablename__ = "subscriptions"

    plan: Mapped[str] = mapped_column(String(30), nullable=False, default="free")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    provider_subscription_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    current_period_start: Mapped[datetime | None] = mapped_column(nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(nullable=True)
    cancel_at: Mapped[datetime | None] = mapped_column(nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
