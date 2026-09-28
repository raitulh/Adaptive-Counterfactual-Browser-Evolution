"""System-level tables shared across modules (not tenant-scoped ORM entities)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, BigIntPKMixin, TimestampMixin, UUIDPrimaryKeyMixin


class OutboxEvent(BigIntPKMixin, Base):
    """Transactional outbox: written in the same transaction as the state change it
    describes, relayed to the event bus afterwards (at-least-once)."""

    __tablename__ = "outbox_events"

    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(server_default=text("now()"), nullable=False)
    published_at: Mapped[datetime | None] = mapped_column(nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    __table_args__ = (
        Index("ix_outbox_events_unpublished", "id", postgresql_where=text("published_at IS NULL")),
    )


class ApiIdempotencyKey(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Stores the outcome of write requests carrying an ``Idempotency-Key`` header."""

    __tablename__ = "api_idempotency_keys"

    tenant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="in_progress")
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[Any | None] = mapped_column(JSONB, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "key"),
        Index("ix_api_idempotency_keys_expires_at", "expires_at"),
    )


class FeatureFlag(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Per-tenant (or global when tenant_id is NULL) feature flag overrides."""

    __tablename__ = "feature_flags"

    key: Mapped[str] = mapped_column(String(100), nullable=False)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    rollout_percentage: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        Index("uq_feature_flags_key_tenant", "key", "tenant_id", unique=True, postgresql_nulls_not_distinct=True),
    )


class WebhookDelivery(UUIDPrimaryKeyMixin, Base):
    """Replay/duplicate protection for inbound webhooks (unique per provider delivery id)."""

    __tablename__ = "webhook_deliveries"

    provider: Mapped[str] = mapped_column(String(50), nullable=False)
    delivery_id: Mapped[str] = mapped_column(String(200), nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="received")
    received_at: Mapped[datetime] = mapped_column(server_default=text("now()"), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (UniqueConstraint("provider", "delivery_id"),)


class WorkerHeartbeat(Base):
    __tablename__ = "worker_heartbeats"

    worker_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    queues: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    started_at: Mapped[datetime] = mapped_column(nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(nullable=False)
    jobs_in_flight: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    jobs_processed: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    host: Mapped[str | None] = mapped_column(String(200), nullable=True)
