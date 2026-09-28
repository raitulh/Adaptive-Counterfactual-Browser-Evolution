"""Task domain tables: the durable unit of work and its DAG, events and attempts."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class Task(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, Base):
    __tablename__ = "tasks"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    agent_version_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_versions.id", ondelete="SET NULL"))
    automation_run_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tasks.id", ondelete="SET NULL"))

    goal: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="created")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    progress: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="api")

    # Validated plan snapshot + reproducibility metadata.
    plan: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    policy_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    strategy_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    execution_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    input_context: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    pending_questions: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    result_summary: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    failure_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    failure_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Budgets and counters (enforced by the execution engine).
    budget: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tool_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_calls: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    browser_actions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_micros: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    replans: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Execution lease: at most one worker drives a task at a time.
    lease_owner: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
    event_seq: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)

    cancel_requested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    pause_requested_at: Mapped[datetime | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    deadline_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "user_id", "idempotency_key"),
        Index("ix_tasks_tenant_user_created", "tenant_id", "user_id", "created_at"),
        Index("ix_tasks_tenant_status", "tenant_id", "status"),
        Index("ix_tasks_status_priority", "status", "priority",
              postgresql_where=text("status IN ('queued','running','recovering','verifying')")),
        Index("ix_tasks_lease_expiry", "lease_expires_at", postgresql_where=text("lease_owner IS NOT NULL")),
    )


class TaskStep(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, Base):
    __tablename__ = "task_steps"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    plan_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    step_key: Mapped[str] = mapped_column(String(64), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(200), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_version: Mapped[str] = mapped_column(String(20), nullable=False, default="v1")
    arguments: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    resolved_arguments: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    resolved_args_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    permission_level: Mapped[str] = mapped_column(String(24), nullable=False, default="read")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="low")
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    policy_reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    approval_request_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    expected_result: Mapped[str | None] = mapped_column(Text, nullable=True)
    verification_method: Mapped[str] = mapped_column(String(40), nullable=False, default="output_schema")
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    timeout_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=60.0)
    retry_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=3)
    next_attempt_at: Mapped[datetime | None] = mapped_column(nullable=True)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    output_trust: Mapped[str | None] = mapped_column(String(40), nullable=True)
    output_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("task_id", "plan_version", "step_key"),
        Index("ix_task_steps_task_status", "task_id", "status"),
    )


class TaskDependency(TenantScopedMixin, Base):
    __tablename__ = "task_dependencies"

    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), primary_key=True)
    depends_on_step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("task_steps.id", ondelete="CASCADE"), primary_key=True
    )
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)


class TaskEvent(TenantScopedMixin, Base):
    """Immutable, ordered task event log (``seq`` is gap-free and commit-ordered per task).
    Candidate for monthly range partitioning on ``created_at`` at scale."""

    __tablename__ = "task_events"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    seq: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    step_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="system")
    actor_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (UniqueConstraint("task_id", "seq"), Index("ix_task_events_created", "created_at"))


class TaskAttempt(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """One execution attempt of a step (tool call)."""

    __tablename__ = "task_attempts"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="started")
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    worker_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    started_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    output_summary: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (UniqueConstraint("step_id", "attempt_number"),)


class ExternalAction(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Ledger of side-effecting tool calls, keyed by a stable idempotency key.

    The intent is committed *before* the external call; the outcome after. A row
    left in ``pending`` means the outcome is unknown (crash/timeout after the
    request was sent) and must be reconciled before any retry.
    """

    __tablename__ = "external_actions"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="pending")
    external_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    approval_request_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    reconciled_at: Mapped[datetime | None] = mapped_column(nullable=True)


class ExecutionLog(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """User-safe execution log lines (no chain-of-thought, no secrets)."""

    __tablename__ = "execution_logs"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    step_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="info")
    message: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (Index("ix_execution_logs_task_created", "task_id", "created_at"),
                      Index("ix_execution_logs_created", "created_at"))
