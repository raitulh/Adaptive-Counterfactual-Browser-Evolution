"""Automations: recurring, schedule-triggered tasks.

An ``Automation`` is a cron schedule (evaluated in the automation's IANA time zone) plus a
``TaskCreate``-compatible template. The scheduler materializes each due occurrence into
exactly one ``AutomationRun`` (unique per automation + scheduled time) and one task created
on behalf of the owner; workers then plan and execute that task like any other.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.common.time import utcnow
from app.core.database import (
    Base,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionedMixin,
)


class TriggerType:
    SCHEDULE = "schedule"


class RunStatus:
    CREATED = "created"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    SKIPPED = "skipped"


DEFAULT_POLICY: dict[str, Any] = {"pause_on_failure": True, "max_consecutive_failures": 3}
DEFAULT_RETRY_POLICY: dict[str, Any] = {"max_attempts": 3, "backoff_seconds": 60}


class Automation(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, SoftDeleteMixin,
                 Base):
    __tablename__ = "automations"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False, default=TriggerType.SCHEDULE)
    cron_expression: Mapped[str] = mapped_column(String(120), nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="UTC")
    # TaskCreate-compatible: {"goal", "agent_id", "context", "priority", "max_duration_seconds"}.
    task_template: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_runs: Mapped[int | None] = mapped_column(Integer, nullable=True)
    run_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Retries apply to *materializing* a run (e.g. owner already at the active-task limit);
    # a created task is never re-run automatically, since its actions may have side effects.
    retry_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False,
                                                         default=lambda: dict(DEFAULT_RETRY_POLICY))
    policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False,
                                                   default=lambda: dict(DEFAULT_POLICY))
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Next occurrence (computed in ``timezone``, stored as UTC). NULL when disabled/exhausted.
    next_run_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_run_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Why the automation was disabled by the system (paused_after_failures, owner_access_lost,
    # max_runs_reached); NULL when enabled or disabled by the user.
    disabled_reason: Mapped[str | None] = mapped_column(String(60), nullable=True)

    __table_args__ = (
        Index("ix_automations_enabled_next_run", "enabled", "next_run_at",
              postgresql_where=text("enabled AND deleted_at IS NULL")),
        Index("ix_automations_tenant_user_created", "tenant_id", "user_id", "created_at"),
    )


class AutomationRun(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """One materialized occurrence. ``UNIQUE (automation_id, scheduled_for)`` makes run
    creation exactly-once even with several scheduler replicas."""

    __tablename__ = "automation_runs"

    automation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"),
                                                     nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(nullable=False)
    trigger: Mapped[str] = mapped_column(String(20), nullable=False, default="schedule")  # schedule | manual
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"),
                                                      nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=RunStatus.CREATED)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, default=utcnow, server_default=text("now()"))
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("automation_id", "scheduled_for"),
        Index("ix_automation_runs_automation_created", "automation_id", "created_at"),
        Index("ix_automation_runs_open", "status", "next_attempt_at",
              postgresql_where=text("status = 'created'")),
        Index("ix_automation_runs_task", "task_id", postgresql_where=text("task_id IS NOT NULL")),
    )
