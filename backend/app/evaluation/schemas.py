"""Evaluation / experiment API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.acbe.runtime import StrategyConfig

_LABEL = r"^[A-Za-z0-9_.+:\-]{1,80}$"
_NAME = r"^[a-z0-9_\-]{1,40}$"
ExperimentKindName = Literal["agent_version", "planner_strategy", "memory_retrieval", "verification_strategy",
                             "recovery_strategy", "acbe_strategy"]


class EvaluationRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    suite: str = Field(default="core", pattern=r"^[a-z0-9_\-]{1,80}$")
    strategy: StrategyConfig | None = Field(default=None, description="Strategy pinned for every case (default: none)")
    label: str = Field(default="baseline", pattern=_LABEL)
    model_mode: Literal["scripted", "configured"] = Field(
        default="scripted", description="scripted plans (deterministic) or the configured model for use_model cases")
    repetitions: int = Field(default=1, ge=1, le=10)
    case_ids: list[str] | None = Field(default=None, max_length=200)
    platform: bool = Field(default=False, description="Platform-level run (platform administrators only)")


class EvaluationRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    suite: str
    status: str
    strategy_label: str
    strategy_config: dict[str, Any]
    model: str
    repetitions: int
    case_ids: list[str] | None
    experiment_id: uuid.UUID | None
    variant: str | None
    started_at: datetime | None
    completed_at: datetime | None
    metrics: dict[str, Any]
    error: str | None
    created_by: uuid.UUID | None
    created_at: datetime


class EvaluationResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    case_id: str
    repetition: int
    category: str
    passed: bool
    task_status: str | None
    false_completion: bool
    unauthorized_action: bool
    verification_passed: bool | None
    recovered: bool | None
    tool_call_accuracy: float | None
    latency_ms: float
    cost_usd: float
    details: dict[str, Any]
    created_at: datetime


class EvaluationRunDetail(EvaluationRunOut):
    results: list[EvaluationResultOut] = Field(default_factory=list)


class SuiteCaseOut(BaseModel):
    id: str
    category: str
    goal: str
    description: str


class SuiteOut(BaseModel):
    name: str
    cases: list[SuiteCaseOut]


class VariantSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(pattern=_NAME)
    config: StrategyConfig = Field(default_factory=StrategyConfig)
    weight: float = Field(default=1.0, gt=0, le=100)


class ExperimentCreate(BaseModel):
    """The first variant is the control. Variants may only differ in ``StrategyConfig`` knobs."""

    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    kind: ExperimentKindName
    hypothesis: str = Field(default="", max_length=4000)
    variants: list[VariantSpec] = Field(min_length=2, max_length=5)
    evaluation_set: str = Field(default="core", pattern=r"^[a-z0-9_\-]{1,80}$")
    repetitions: int = Field(default=1, ge=1, le=10)
    platform: bool = False

    @model_validator(mode="after")
    def _unique(self) -> ExperimentCreate:
        names = [v.name for v in self.variants]
        if len(set(names)) != len(names):
            raise ValueError("variant names must be unique")
        return self


class ExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    name: str
    kind: str
    hypothesis: str
    variants: list[dict[str, Any]]
    evaluation_set: str
    repetitions: int
    metrics: dict[str, Any]
    status: str
    rollout_percentage: int
    winner_variant: str | None
    winner_reason: str | None
    safety_checks: dict[str, Any]
    strategy_candidate_id: uuid.UUID | None
    created_by: uuid.UUID | None
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    decided_at: datetime | None
    rolled_back_at: datetime | None
    rollback_reason: str | None
    created_at: datetime
    updated_at: datetime


class ExperimentDetail(ExperimentOut):
    runs: list[EvaluationRunOut] = Field(default_factory=list)


class RolloutRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rollout_percentage: int = Field(ge=1, le=100, description="1–99 = canary, 100 = promote (after the canary)")


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)
