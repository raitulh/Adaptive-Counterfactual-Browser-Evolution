from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, UUIDPrimaryKeyMixin


class FailureRecord(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """A classified failure. ``verified`` = the failure is established fact (not a
    transient blip), which makes it eligible input for ACBE strategy learning."""

    __tablename__ = "failure_records"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    step_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=True)
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    tool_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    error_class: Mapped[str] = mapped_column(String(40), nullable=False)
    error_code: Mapped[str] = mapped_column(String(80), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    context_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    strategy_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_failure_records_tenant_created", "tenant_id", "created_at"),
        Index("ix_failure_records_fingerprint", "fingerprint"),
    )


class RecoveryAttempt(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    __tablename__ = "recovery_attempts"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    failure_record_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("failure_records.id", ondelete="SET NULL"), nullable=True)
    decision: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="applied")
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
