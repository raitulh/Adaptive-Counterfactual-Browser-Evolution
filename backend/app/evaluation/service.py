"""Evaluation runs and generic experiments (API use-cases).

Runs are *enqueued* on the ``evaluation`` queue (the harness swaps process-level
singletons, so it only runs on dedicated evaluation workers — never in the API).
Experiment winners are chosen by ``acbe.experiments.promotion_gate`` (deterministic
statistics + safety gates); rolling a winner out creates a ``passed`` strategy
candidate that goes through the same human-approved canary → promote → rollback path
as ACBE-learned strategies, so an experiment can never bypass safety policy.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.acbe import service as acbe_service
from app.acbe.candidates import UnsafeCandidate, validate_candidate_config
from app.acbe.experiments import GateDecision, GateRow, PromotionPolicy, promotion_gate
from app.acbe.runtime import StrategyConfig
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.pagination import apply_keyset
from app.common.time import utcnow
from app.core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from app.evaluation.models import (
    EvaluationResult,
    EvaluationRun,
    Experiment,
    ExperimentStatus,
    RunStatus,
)
from app.evaluation.runner import model_label, select_cases
from app.evaluation.schemas import EvaluationRunCreate, ExperimentCreate
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

require_manager = acbe_service.require_manager


def _scope_tenant(ctx: RequestContext, platform: bool) -> uuid.UUID | None:
    if platform and not ctx.is_platform_admin:
        raise Forbidden("Platform-level evaluations require a platform administrator",
                        code="platform_admin_required")
    return None if platform else ctx.tenant_id


def _visible_runs(ctx: RequestContext) -> Select[Any]:
    stmt = select(EvaluationRun)
    return stmt if ctx.is_platform_admin else stmt.where(EvaluationRun.tenant_id == ctx.tenant_id)


def _visible_experiments(ctx: RequestContext) -> Select[Any]:
    stmt = select(Experiment)
    return stmt if ctx.is_platform_admin else stmt.where(Experiment.tenant_id == ctx.tenant_id)


def _run_job(run: EvaluationRun) -> JobSpec:
    return JobSpec(queue=Queues.EVALUATION, job_type="evaluation.run", payload={"run_id": str(run.id)},
                   dedupe_key=f"evaluation.run:{run.id}", tenant_id=run.tenant_id, max_attempts=3)


# ---------------------------------------------------------------------------- runs
async def enqueue_run(session: AsyncSession, ctx: RequestContext, body: EvaluationRunCreate) -> EvaluationRun:
    require_manager(ctx)
    tenant_id = _scope_tenant(ctx, body.platform)
    select_cases(body.suite, case_ids=body.case_ids, model_mode=body.model_mode)
    run = EvaluationRun(suite=body.suite, status=RunStatus.QUEUED, strategy_label=body.label,
                        strategy_config=(body.strategy or StrategyConfig()).model_dump(mode="json"),
                        model=model_label(body.model_mode), repetitions=body.repetitions,
                        case_ids=body.case_ids, tenant_id=tenant_id, created_by=ctx.user_id)
    session.add(run)
    await session.flush()
    await get_job_queue().enqueue(session, _run_job(run))
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="evaluation.run.requested",
                 resource_type="evaluation_run", resource_id=run.id,
                 metadata={"suite": run.suite, "label": run.strategy_label, "model": run.model,
                           "platform": tenant_id is None})
    await session.commit()
    return run


async def list_runs(session: AsyncSession, ctx: RequestContext, *, cursor: str | None, limit: int
                    ) -> list[EvaluationRun]:
    require_manager(ctx)
    return list((await session.execute(apply_keyset(_visible_runs(ctx), EvaluationRun, cursor, limit)))
                .scalars().all())


async def get_run(session: AsyncSession, ctx: RequestContext, run_id: uuid.UUID
                  ) -> tuple[EvaluationRun, list[EvaluationResult]]:
    require_manager(ctx)
    run: EvaluationRun | None = (await session.execute(_visible_runs(ctx).where(EvaluationRun.id == run_id))
                                 ).scalar_one_or_none()
    if run is None:
        raise NotFound("Evaluation run not found")
    results = list((await session.execute(select(EvaluationResult).where(EvaluationResult.run_id == run_id)
                                          .order_by(EvaluationResult.created_at))).scalars().all())
    return run, results


# ---------------------------------------------------------------------------- experiments
async def create_experiment(session: AsyncSession, ctx: RequestContext, body: ExperimentCreate) -> Experiment:
    require_manager(ctx)
    tenant_id = _scope_tenant(ctx, body.platform)
    select_cases(body.evaluation_set)
    for variant in body.variants:  # every variant must be a safe, bounded strategy
        try:
            validate_candidate_config(variant.config)
        except UnsafeCandidate as exc:
            raise ValidationFailed(f"Variant '{variant.name}' is not a safe strategy: {exc}",
                                   code="unsafe_strategy") from exc
    experiment = Experiment(tenant_id=tenant_id, name=body.name, kind=body.kind, hypothesis=body.hypothesis,
                            variants=[v.model_dump(mode="json") for v in body.variants],
                            evaluation_set=body.evaluation_set, repetitions=body.repetitions,
                            status=ExperimentStatus.DRAFT, created_by=ctx.user_id)
    session.add(experiment)
    await session.flush()
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="experiment.create",
                 resource_type="experiment", resource_id=experiment.id,
                 metadata={"kind": body.kind, "variants": [v.name for v in body.variants],
                           "evaluation_set": body.evaluation_set})
    await session.commit()
    return experiment


async def list_experiments(session: AsyncSession, ctx: RequestContext, *, cursor: str | None, limit: int
                           ) -> list[Experiment]:
    require_manager(ctx)
    return list((await session.execute(apply_keyset(_visible_experiments(ctx), Experiment, cursor, limit)))
                .scalars().all())


async def get_experiment(session: AsyncSession, ctx: RequestContext, experiment_id: uuid.UUID, *,
                         lock: bool = False) -> Experiment:
    require_manager(ctx)
    stmt = _visible_experiments(ctx).where(Experiment.id == experiment_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    experiment: Experiment | None = (await session.execute(stmt)).scalar_one_or_none()
    if experiment is None:
        raise NotFound("Experiment not found")
    return experiment


def _authorize_change(ctx: RequestContext, experiment: Experiment) -> None:
    if experiment.tenant_id is None and not ctx.is_platform_admin:
        raise Forbidden("Platform-level experiments can only be changed by a platform administrator",
                        code="platform_admin_required")


async def experiment_runs(session: AsyncSession, experiment_id: uuid.UUID) -> list[EvaluationRun]:
    return list((await session.execute(select(EvaluationRun).where(EvaluationRun.experiment_id == experiment_id)
                                       .order_by(EvaluationRun.created_at))).scalars().all())


def _variant_label(experiment: Experiment, variant: str) -> str:
    return f"exp-{experiment.id.hex[:8]}-{variant}"[:80]


async def start_experiment(session: AsyncSession, ctx: RequestContext, experiment_id: uuid.UUID) -> Experiment:
    experiment = await get_experiment(session, ctx, experiment_id, lock=True)
    _authorize_change(ctx, experiment)
    if experiment.status != ExperimentStatus.DRAFT:
        raise Conflict(f"A {experiment.status} experiment cannot be started", code="invalid_experiment_state")
    for variant in experiment.variants:
        run = EvaluationRun(suite=experiment.evaluation_set, status=RunStatus.QUEUED,
                            strategy_label=_variant_label(experiment, variant["name"]),
                            strategy_config=StrategyConfig.model_validate(variant["config"]).model_dump(mode="json"),
                            model=model_label("scripted"), repetitions=experiment.repetitions,
                            tenant_id=experiment.tenant_id, created_by=ctx.user_id, experiment_id=experiment.id,
                            variant=variant["name"])
        session.add(run)
        await session.flush()
        await get_job_queue().enqueue(session, _run_job(run))
    experiment.status = ExperimentStatus.RUNNING
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="experiment.start",
                 resource_type="experiment", resource_id=experiment.id,
                 metadata={"variants": [v["name"] for v in experiment.variants]})
    await session.commit()
    return experiment


def _gate_rows(results: list[EvaluationResult]) -> list[GateRow]:
    return [GateRow(case_id=r.case_id, repetition=r.repetition, passed=r.passed, false_completion=r.false_completion,
                    unauthorized_action=r.unauthorized_action, cost_usd=r.cost_usd, target=True, regression=True)
            for r in results]


def choose_winner(control: str, decisions: dict[str, GateDecision], rows: dict[str, list[GateRow]]
                  ) -> tuple[str | None, str]:
    """Deterministic: the passing challenger with the best success rate, then the lowest cost."""
    passing = [name for name, d in decisions.items() if d.decision == "passed"]
    if not passing:
        reasons = "; ".join(f"{name}: {d.reason}" for name, d in decisions.items())
        return None, f"no variant beat the control '{control}' ({reasons})"[:2000]

    def key(name: str) -> tuple[float, float, str]:
        variant_rows = rows[name]
        rate = sum(1 for r in variant_rows if r.passed) / len(variant_rows) if variant_rows else 0.0
        cost = sum(r.cost_usd for r in variant_rows) / len(variant_rows) if variant_rows else 0.0
        return -rate, cost, name

    winner = sorted(passing, key=key)[0]
    return winner, decisions[winner].reason


async def decide_experiment(session: AsyncSession, ctx: RequestContext, experiment_id: uuid.UUID, *,
                            policy: PromotionPolicy | None = None) -> Experiment:
    experiment = await get_experiment(session, ctx, experiment_id, lock=True)
    _authorize_change(ctx, experiment)
    if experiment.status not in (ExperimentStatus.RUNNING, ExperimentStatus.EVALUATED, ExperimentStatus.REJECTED):
        raise Conflict(f"A {experiment.status} experiment cannot be decided", code="invalid_experiment_state")
    runs = await experiment_runs(session, experiment.id)
    latest: dict[str, EvaluationRun] = {}
    for run in runs:
        if run.variant:
            latest[run.variant] = run
    names = [v["name"] for v in experiment.variants]
    unfinished = [n for n in names if n not in latest or latest[n].status != RunStatus.COMPLETED]
    if unfinished:
        raise Conflict("Evaluation runs have not finished for every variant", code="experiment_runs_pending",
                       details={"variants": unfinished})
    rows: dict[str, list[GateRow]] = {}
    for name in names:
        results = (await session.execute(select(EvaluationResult).where(
            EvaluationResult.run_id == latest[name].id))).scalars().all()
        rows[name] = _gate_rows(list(results))
    control = names[0]
    policy = policy or PromotionPolicy()
    decisions = {name: promotion_gate(rows[control], rows[name], policy) for name in names[1:]}
    winner, reason = choose_winner(control, decisions, rows)
    experiment.metrics = {name: latest[name].metrics for name in names}
    experiment.safety_checks = {name: {"decision": d.decision, "reason": d.reason, "confidence": d.confidence,
                                       "gain": d.gain, "checks": d.safety_checks} for name, d in decisions.items()}
    experiment.winner_variant = winner
    experiment.winner_reason = reason
    experiment.status = ExperimentStatus.EVALUATED if winner else ExperimentStatus.REJECTED
    experiment.decided_at = utcnow()
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="experiment.decide",
                 resource_type="experiment", resource_id=experiment.id,
                 metadata={"winner": winner, "status": experiment.status,
                           "decisions": {n: d.decision for n, d in decisions.items()}})
    await session.commit()
    return experiment


def _variant_config(experiment: Experiment, name: str) -> StrategyConfig:
    for variant in experiment.variants:
        if variant["name"] == name:
            return StrategyConfig.model_validate(variant["config"])
    raise NotFound("Variant not found")


async def set_rollout(session: AsyncSession, ctx: RequestContext, experiment_id: uuid.UUID,
                      rollout_percentage: int) -> Experiment:
    experiment = await get_experiment(session, ctx, experiment_id, lock=True)
    _authorize_change(ctx, experiment)
    control = experiment.variants[0]["name"] if experiment.variants else None
    if experiment.status not in (ExperimentStatus.EVALUATED, ExperimentStatus.CANARY) \
            or not experiment.winner_variant or experiment.winner_variant == control:
        raise Conflict("Only an evaluated experiment with a winning challenger can be rolled out",
                       code="invalid_experiment_state")
    if rollout_percentage >= 100 and experiment.status != ExperimentStatus.CANARY:
        raise Conflict("Roll out as a canary first; promotion follows the canary period", code="canary_required")
    if experiment.strategy_candidate_id is None:
        candidate = await acbe_service.register_experiment_strategy(
            session, ctx, experiment_id=experiment.id, tenant_id=experiment.tenant_id,
            variant=experiment.winner_variant, config=_variant_config(experiment, experiment.winner_variant),
            rationale=f"Experiment '{experiment.name}' winner: {experiment.winner_reason or ''}")
        experiment.strategy_candidate_id = candidate.id
    previous = experiment.status
    experiment.approved_by = ctx.user_id
    experiment.approved_at = utcnow()
    experiment.rollout_percentage = rollout_percentage
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="experiment.rollout",
                 resource_type="experiment", resource_id=experiment.id,
                 metadata={"rollout_percentage": rollout_percentage, "previous_status": previous,
                           "variant": experiment.winner_variant})
    if rollout_percentage >= 100:
        experiment.status = ExperimentStatus.PROMOTED
        await acbe_service.promote(session, ctx, experiment.strategy_candidate_id)
    else:
        experiment.status = ExperimentStatus.CANARY
        await acbe_service.approve_canary(session, ctx, experiment.strategy_candidate_id, rollout_percentage)
    return experiment


async def rollback_experiment(session: AsyncSession, ctx: RequestContext, experiment_id: uuid.UUID,
                              reason: str) -> Experiment:
    experiment = await get_experiment(session, ctx, experiment_id, lock=True)
    _authorize_change(ctx, experiment)
    if experiment.status not in (ExperimentStatus.EVALUATED, ExperimentStatus.CANARY, ExperimentStatus.PROMOTED):
        raise Conflict(f"A {experiment.status} experiment cannot be rolled back", code="invalid_experiment_state")
    experiment.status = ExperimentStatus.ROLLED_BACK
    experiment.rollout_percentage = 0
    experiment.rolled_back_at = utcnow()
    experiment.rollback_reason = reason[:2000]
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="experiment.rollback",
                 resource_type="experiment", resource_id=experiment.id, metadata={"reason": reason[:300]})
    candidate_id = experiment.strategy_candidate_id
    if candidate_id is not None:
        candidate = await acbe_service.get_candidate(session, ctx, candidate_id)
        if candidate.status in ("passed", "canary", "promoted"):
            await acbe_service.rollback(session, ctx, candidate_id, reason)
            return experiment
    await session.commit()
    return experiment


def suite_catalog() -> list[dict[str, Any]]:
    from app.evaluation.cases import SUITES

    return [{"name": name, "cases": [{"id": c.id, "category": c.category, "goal": c.goal,
                                      "description": c.description} for c in factory()]}
            for name, factory in SUITES.items()]

