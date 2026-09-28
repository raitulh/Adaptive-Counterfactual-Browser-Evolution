"""ACBE controlled-learning API (platform administrators or ``experiments:manage``).

Candidates only ever go live through a human decision here (canary → promote), and
can be rolled back at any time.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict, Field

from app.acbe import service
from app.api.dependencies import Ctx, DbSession
from app.common.context import RequestContext
from app.common.pagination import Page, build_page, clamp_limit
from app.core.exceptions import Forbidden
from app.organizations.rbac import P

router = APIRouter(prefix="/acbe", tags=["acbe"])

_STATUS_PATTERN = "^(draft|evaluating|passed|rejected|canary|promoted|rolled_back|retired)$"


async def require_experiments_manager(ctx: Ctx) -> RequestContext:
    if not service.can_manage(ctx):
        raise Forbidden(details={"missing_permissions": [P.EXPERIMENTS_MANAGE]})
    return ctx


Manager = Annotated[RequestContext, Depends(require_experiments_manager)]


class FailurePatternOut(BaseModel):
    fingerprint: str
    tool_name: str | None
    error_class: str
    error_code: str
    failure_type: str
    learnable: bool
    occurrences: int
    tasks: int
    first_seen: datetime
    last_seen: datetime
    significant: bool
    strategy_versions: dict[str, int]
    sample_message: str


class CandidateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    scope: str
    failure_type: str
    failure_fingerprint: str
    source_failure_ids: list[str]
    failed_strategy: dict[str, Any]
    candidate_config: dict[str, Any]
    rationale: str
    status: str
    version_label: str
    rollout_percentage: int
    created_by: str
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    promoted_at: datetime | None
    rolled_back_at: datetime | None
    rollback_reason: str | None
    created_at: datetime
    updated_at: datetime


class ExperimentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    experiment_version: int
    evaluation_suite: str
    status: str
    baseline_metrics: dict[str, Any]
    candidate_metrics: dict[str, Any]
    regression_metrics: dict[str, Any]
    safety_checks: dict[str, Any]
    decision: str | None
    decision_reason: str | None
    confidence: float | None
    started_at: datetime
    completed_at: datetime | None


class CandidateDetail(CandidateOut):
    experiments: list[ExperimentOut] = Field(default_factory=list)


class CanaryRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rollout_percentage: int = Field(ge=1, le=100, description="Share of tasks (deterministic per task) on the canary")


class RollbackRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)


@router.get("/failures", response_model=list[FailurePatternOut],
            summary="Verified failure patterns of this organization (fingerprint, taxonomy, significance)")
async def list_failures(ctx: Manager, db: DbSession) -> list[FailurePatternOut]:
    patterns = await service.failure_patterns(db, ctx)
    return [FailurePatternOut.model_validate(p.as_dict()) for p in patterns]


@router.get("/candidates", response_model=Page[CandidateOut], summary="List strategy candidates")
async def list_candidates(ctx: Manager, db: DbSession, status_filter: str | None = Query(
        None, alias="status", pattern=_STATUS_PATTERN), cursor: str | None = None,
        limit: int = Query(50, ge=1, le=200)) -> Page[CandidateOut]:
    lim = clamp_limit(limit)
    rows = await service.list_candidates(db, ctx, status=status_filter, cursor=cursor, limit=lim)
    return build_page(rows, lim, CandidateOut.model_validate)


@router.get("/candidates/{candidate_id}", response_model=CandidateDetail,
            summary="Get a strategy candidate with its experiments")
async def get_candidate(candidate_id: uuid.UUID, ctx: Manager, db: DbSession) -> CandidateDetail:
    candidate = await service.get_candidate(db, ctx, candidate_id)
    detail = CandidateDetail.model_validate(candidate)
    detail.experiments = [ExperimentOut.model_validate(e) for e in await service.list_experiments(db, candidate.id)]
    return detail


@router.post("/candidates/{candidate_id}/evaluate", response_model=CandidateOut,
             status_code=status.HTTP_202_ACCEPTED,
             summary="Enqueue a baseline-vs-candidate experiment with the promotion gate")
async def evaluate_candidate(candidate_id: uuid.UUID, ctx: Manager, db: DbSession) -> CandidateOut:
    return CandidateOut.model_validate(await service.request_evaluation(db, ctx, candidate_id))


@router.post("/candidates/{candidate_id}/canary", response_model=CandidateOut,
             summary="Approve a canary rollout of a candidate that passed evaluation")
async def approve_canary(candidate_id: uuid.UUID, body: CanaryRequest, ctx: Manager, db: DbSession) -> CandidateOut:
    return CandidateOut.model_validate(await service.approve_canary(db, ctx, candidate_id, body.rollout_percentage))


@router.post("/candidates/{candidate_id}/promote", response_model=CandidateOut,
             summary="Promote a canary after its observation period (failure rate must not increase)")
async def promote_candidate(candidate_id: uuid.UUID, ctx: Manager, db: DbSession) -> CandidateOut:
    return CandidateOut.model_validate(await service.promote(db, ctx, candidate_id))


@router.post("/candidates/{candidate_id}/rollback", response_model=CandidateOut,
             summary="Roll back a canary/promoted strategy immediately")
async def rollback_candidate(candidate_id: uuid.UUID, body: RollbackRequest, ctx: Manager, db: DbSession
                             ) -> CandidateOut:
    return CandidateOut.model_validate(await service.rollback(db, ctx, candidate_id, body.reason))
