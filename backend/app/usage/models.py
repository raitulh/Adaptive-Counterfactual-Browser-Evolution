from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import BigInteger, Date, Float, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, UUIDPrimaryKeyMixin


class UsageKind:
    MODEL_CALL = "model_call"
    MODEL_INPUT_TOKENS = "model_input_tokens"
    MODEL_OUTPUT_TOKENS = "model_output_tokens"
    TOOL_CALL = "tool_call"
    BROWSER_SECONDS = "browser_seconds"
    BROWSER_ACTION = "browser_action"
    SEARCH_QUERY = "search_query"
    STORAGE_BYTES = "storage_bytes"
    AUTOMATION_RUN = "automation_run"
    TASK_CREATED = "task_created"
    EMBEDDING = "embedding"


class UsageEvent(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """Append-only metering events. Partition by month (occurred_at) at scale."""

    __tablename__ = "usage_events"

    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    unit: Mapped[str] = mapped_column(String(20), nullable=False, default="count")
    cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(200), nullable=True, unique=True)
    occurred_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (Index("ix_usage_events_tenant_kind_time", "tenant_id", "kind", "occurred_at"),)


class UsageAggregate(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """Rolled-up usage per (tenant, user, agent, period, kind). Eventually consistent."""

    __tablename__ = "usage_aggregates"

    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    period: Mapped[str] = mapped_column(String(10), nullable=False)  # day | month
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("uq_usage_aggregates_key", "tenant_id", "user_id", "agent_id", "period", "period_start", "kind",
              unique=True, postgresql_nulls_not_distinct=True),
    )
