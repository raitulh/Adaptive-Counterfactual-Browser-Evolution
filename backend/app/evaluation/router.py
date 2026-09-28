"""Evaluation + experiment API (platform administrators or ``experiments:manage``)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import JSONResponse

from app.acbe.service import can_manage
from app.api.dependencies import Ctx, DbSession, IdempotencyKeyHeader
from app.common.context import RequestContext
from app.common.idempotency import run_idempotent
from app.common.pagination import Page, build_page, clamp_limit
from app.core.exceptions import Forbidden
from app.evaluation import service
from app.evaluation.schemas import (
    EvaluationResultOut,
    EvaluationRunCreate,
    EvaluationRunDetail,
    EvaluationRunOut,
    ExperimentCreate,
    ExperimentDetail,
    ExperimentOut,
    RollbackRequest,
    RolloutRequest,
    SuiteOut,
)
from app.organizations.rbac import P

router = APIRouter(prefix="/evaluations", tags=["evaluation"])
experiments_router = APIRouter(prefix="/experiments", tags=["evaluation"])


async def require_experiments_manager(ctx: Ctx) -> RequestContext:
    if not can_manage(ctx):
        raise Forbidden(details={"missing_permissions": [P.EXPERIMENTS_MANAGE]})
    return ctx


Manager = Annotated[RequestContext, Depends(require_experiments_manager)]


def _replay(result_status: int, body: object, replayed: bool) -> JSONResponse:
    return JSONResponse(body, status_code=result_status, headers={"Idempotent-Replayed": "true"} if replayed else None)


# ---------------------------------------------------------------------------- runs
@router.post("", response_model=EvaluationRunOut, status_code=status.HTTP_202_ACCEPTED,
             summary="Enqueue an evaluation run of a suite (runs on the dedicated evaluation worker)")
async def create_run(body: EvaluationRunCreate, request: Request, ctx: Manager, db: DbSession,
                     idempotency_key: IdempotencyKeyHeader = None) -> JSONResponse:
    async def handler() -> tuple[int, EvaluationRunOut]:
        return 202, EvaluationRunOut.model_validate(await service.enqueue_run(db, ctx, body))

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path, body.model_dump(mode="json"),
                                  handler)
    return _replay(result.status_code, result.body, result.replayed)


@router.get("", response_model=Page[EvaluationRunOut], summary="List evaluation runs")
async def list_runs(ctx: Manager, db: DbSession, cursor: str | None = None,
                    limit: int = Query(50, ge=1, le=200)) -> Page[EvaluationRunOut]:
    lim = clamp_limit(limit)
    rows = await service.list_runs(db, ctx, cursor=cursor, limit=lim)
    return build_page(rows, lim, EvaluationRunOut.model_validate)


@router.get("/suites", response_model=list[SuiteOut], summary="Built-in evaluation suites and their cases")
async def list_suites(ctx: Manager) -> list[SuiteOut]:
    return [SuiteOut.model_validate(s) for s in service.suite_catalog()]


@router.get("/{run_id}", response_model=EvaluationRunDetail, summary="Get an evaluation run with per-case results")
async def get_run(run_id: uuid.UUID, ctx: Manager, db: DbSession) -> EvaluationRunDetail:
    run, results = await service.get_run(db, ctx, run_id)
    detail = EvaluationRunDetail.model_validate(run)
    detail.results = [EvaluationResultOut.model_validate(r) for r in results]
    return detail


# ---------------------------------------------------------------------------- experiments
@experiments_router.post("", response_model=ExperimentOut, status_code=status.HTTP_201_CREATED,
                         summary="Create a controlled experiment (first variant = control)")
async def create_experiment(body: ExperimentCreate, request: Request, ctx: Manager, db: DbSession,
                            idempotency_key: IdempotencyKeyHeader = None) -> JSONResponse:
    async def handler() -> tuple[int, ExperimentOut]:
        return 201, ExperimentOut.model_validate(await service.create_experiment(db, ctx, body))

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path, body.model_dump(mode="json"),
                                  handler)
    return _replay(result.status_code, result.body, result.replayed)


@experiments_router.get("", response_model=Page[ExperimentOut], summary="List experiments")
async def list_experiments(ctx: Manager, db: DbSession, cursor: str | None = None,
                           limit: int = Query(50, ge=1, le=200)) -> Page[ExperimentOut]:
    lim = clamp_limit(limit)
    rows = await service.list_experiments(db, ctx, cursor=cursor, limit=lim)
    return build_page(rows, lim, ExperimentOut.model_validate)


@experiments_router.get("/{experiment_id}", response_model=ExperimentDetail,
                        summary="Get an experiment with its evaluation runs")
async def get_experiment(experiment_id: uuid.UUID, ctx: Manager, db: DbSession) -> ExperimentDetail:
    experiment = await service.get_experiment(db, ctx, experiment_id)
    detail = ExperimentDetail.model_validate(experiment)
    detail.runs = [EvaluationRunOut.model_validate(r) for r in await service.experiment_runs(db, experiment.id)]
    return detail


@experiments_router.post("/{experiment_id}/start", response_model=ExperimentOut,
                         status_code=status.HTTP_202_ACCEPTED,
                         summary="Start: enqueue an evaluation run for every variant")
async def start_experiment(experiment_id: uuid.UUID, ctx: Manager, db: DbSession) -> ExperimentOut:
    return ExperimentOut.model_validate(await service.start_experiment(db, ctx, experiment_id))


@experiments_router.post("/{experiment_id}/decide", response_model=ExperimentOut,
                         summary="Compute the winner with the statistical test and safety gates")
async def decide_experiment(experiment_id: uuid.UUID, ctx: Manager, db: DbSession) -> ExperimentOut:
    return ExperimentOut.model_validate(await service.decide_experiment(db, ctx, experiment_id))


@experiments_router.post("/{experiment_id}/rollout", response_model=ExperimentOut,
                         summary="Human rollout decision for the winner (canary, then promotion)")
async def set_rollout(experiment_id: uuid.UUID, body: RolloutRequest, ctx: Manager, db: DbSession
                      ) -> ExperimentOut:
    return ExperimentOut.model_validate(await service.set_rollout(db, ctx, experiment_id, body.rollout_percentage))


@experiments_router.post("/{experiment_id}/rollback", response_model=ExperimentOut,
                         summary="Roll back an experiment's rollout immediately")
async def rollback_experiment(experiment_id: uuid.UUID, body: RollbackRequest, ctx: Manager, db: DbSession
                              ) -> ExperimentOut:
    return ExperimentOut.model_validate(await service.rollback_experiment(db, ctx, experiment_id, body.reason))
