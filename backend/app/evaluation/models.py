"""Evaluation persistence: suite runs, per-case results and generic controlled experiments.

``tenant_id`` NULL = a platform-level run/experiment (requested by a platform
administrator). These tables are filtered explicitly by the service (like
``strategy_candidates``) instead of using ``TenantScopedMixin``, because a
platform row has no tenant. The *evaluation tenants* the harness creates per case
are never referenced here: they are deleted when the case finishes.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.acbe import models as _acbe_models  # noqa: F401  (strategy_candidates FK target)
from app.core.database import Base, TimestampMixin, UUIDPrimaryKeyMixin


class RunStatus:
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ExperimentKind:
    AGENT_VERSION = "agent_version"
    PLANNER_STRATEGY = "planner_strategy"
    MEMORY_RETRIEVAL = "memory_retrieval"
    VERIFICATION_STRATEGY = "verification_strategy"
    RECOVERY_STRATEGY = "recovery_strategy"
    ACBE_STRATEGY = "acbe_strategy"

    ALL = (AGENT_VERSION, PLANNER_STRATEGY, MEMORY_RETRIEVAL, VERIFICATION_STRATEGY, RECOVERY_STRATEGY,
           ACBE_STRATEGY)


class ExperimentStatus:
    DRAFT = "draft"
    RUNNING = "running"
    EVALUATED = "evaluated"
    CANARY = "canary"
    PROMOTED = "promoted"
    ROLLED_BACK = "rolled_back"
    REJECTED = "rejected"


class EvaluationRun(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "evaluation_runs"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    suite: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=RunStatus.QUEUED)
    strategy_label: Mapped[str] = mapped_column(String(80), nullable=False, default="baseline")
    strategy_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    model: Mapped[str] = mapped_column(String(40), nullable=False, default="scripted")
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    case_ids: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    experiment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("experiments.id", ondelete="CASCADE"), nullable=True, index=True)
    variant: Mapped[str | None] = mapped_column(String(60), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    __table_args__ = (Index("ix_evaluation_runs_tenant_created", "tenant_id", "created_at"),)


class EvaluationResult(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "evaluation_results"

    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("evaluation_runs.id", ondelete="CASCADE"),
                                              nullable=False, index=True)
    case_id: Mapped[str] = mapped_column(String(120), nullable=False)
    repetition: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    passed: Mapped[bool] = mapped_column(Boolean, nullable=False)
    task_status: Mapped[str | None] = mapped_column(String(32), nullable=True)
    false_completion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unauthorized_action: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_passed: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    recovered: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    tool_call_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))


class Experiment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A controlled comparison of configuration variants on an evaluation set.

    Variants carry only ``StrategyConfig`` knobs (validated), so no experiment can
    change permissions, approvals or policy. The winner is chosen by deterministic
    code (statistical test + safety gates); rollout needs a human decision."""

    __tablename__ = "experiments"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, nullable=False, default="")
    variants: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    evaluation_set: Mapped[str] = mapped_column(String(80), nullable=False, default="core")
    repetitions: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=ExperimentStatus.DRAFT)
    rollout_percentage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    winner_variant: Mapped[str | None] = mapped_column(String(60), nullable=True)
    winner_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    safety_checks: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    strategy_candidate_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategy_candidates.id", ondelete="SET NULL"), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rollback_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_experiments_tenant_status", "tenant_id", "status"),)
