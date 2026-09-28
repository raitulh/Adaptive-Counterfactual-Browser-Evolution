"""ACBE (Adaptive Counterfactual Browser Evolution) persistence: candidate strategies,
controlled experiments and per-case results. Strategies are *configuration*, never code."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin, UUIDPrimaryKeyMixin


class StrategyStatus:
    DRAFT = "draft"
    EVALUATING = "evaluating"
    PASSED = "passed"
    REJECTED = "rejected"
    CANARY = "canary"
    PROMOTED = "promoted"
    ROLLED_BACK = "rolled_back"
    RETIRED = "retired"


class StrategyCandidate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """``tenant_id`` NULL = platform-wide strategy. Filtered explicitly (not TenantScopedMixin)."""

    __tablename__ = "strategy_candidates"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True, index=True)
    scope: Mapped[str] = mapped_column(String(128), nullable=False)
    failure_type: Mapped[str] = mapped_column(String(60), nullable=False)
    failure_fingerprint: Mapped[str] = mapped_column(String(64), nullable=False)
    source_failure_ids: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    failed_strategy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    candidate_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    rationale: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=StrategyStatus.DRAFT)
    version_label: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    parent_version: Mapped[str | None] = mapped_column(String(80), nullable=True)
    rollout_percentage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str] = mapped_column(String(60), nullable=False, default="acbe")
    approved_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    promoted_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rolled_back_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rollback_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (Index("ix_strategy_candidates_status", "status", "scope"),)


class StrategyExperiment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "strategy_experiments"

    candidate_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("strategy_candidates.id", ondelete="CASCADE"),
                                                    nullable=False, index=True)
    experiment_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    evaluation_suite: Mapped[str] = mapped_column(String(80), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="running")
    baseline_metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    candidate_metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    regression_metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    safety_checks: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    decision: Mapped[str | None] = mapped_column(String(30), nullable=True)
    decision_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    started_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)


class StrategyResult(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "strategy_results"

    experiment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("strategy_experiments.id", ondelete="CASCADE"),
                                                     nullable=False, index=True)
    variant: Mapped[str] = mapped_column(String(20), nullable=False)
    case_id: Mapped[str] = mapped_column(String(120), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    false_completion: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    unauthorized_action: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    verification_passed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    regression_case: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    latency_ms: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    cost_usd: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
