"""Suite runner: executes cases through the EvaluationHarness and persists results.

Each case result is committed on its own (no transaction spans a case run), so a
crashed run leaves a consistent partial record; re-running the same run id starts
it over (idempotent job semantics).
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass

from sqlalchemy import delete, select

from app.acbe.runtime import StrategyConfig
from app.common.models import WorkerHeartbeat
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.database import system_session
from app.core.exceptions import NotFound, ValidationFailed
from app.evaluation.cases import SUITES, EvaluationCase, get_suite
from app.evaluation.harness import EvaluationHarness, ModelMode
from app.evaluation.metrics import CaseScore, ResultRow, aggregate
from app.evaluation.models import EvaluationResult, EvaluationRun, RunStatus
from app.workers.queues.base import DeferJob, Queues

logger = logging.getLogger(__name__)

ScoreCallback = Callable[[EvaluationCase, int, CaseScore], Awaitable[None]]


@dataclass(slots=True)
class PlannedCase:
    case: EvaluationCase
    repetitions: int = 1


async def ensure_dedicated_evaluation_worker(worker_id: str) -> None:
    """The harness swaps process-wide singletons (tool services, model router, job queue). That is only
    safe in a worker that serves the ``evaluation`` queue alone; anywhere else the job is deferred so a
    dedicated evaluation worker (``--queues evaluation``) picks it up."""
    async with system_session() as session:
        heartbeat = await session.get(WorkerHeartbeat, worker_id)
        queues = set(heartbeat.queues or []) if heartbeat is not None else set()
    if queues != {Queues.EVALUATION}:
        logger.warning("evaluation job deferred: worker is not a dedicated evaluation worker",
                       extra={"worker_id": worker_id, "queues": sorted(queues)})
        raise DeferJob("evaluation work needs a dedicated evaluation worker (--queues evaluation)",
                       delay_seconds=60)


def model_label(model_mode: ModelMode) -> str:
    return "scripted" if model_mode == "scripted" else get_settings().gemini_default_model


def select_cases(suite: str, *, case_ids: Sequence[str] | None = None, model_mode: ModelMode = "scripted"
                 ) -> list[EvaluationCase]:
    if suite not in SUITES:
        raise ValidationFailed(f"Unknown evaluation suite '{suite}'", details={"suites": sorted(SUITES)})
    cases = get_suite(suite)
    if case_ids:
        wanted = set(case_ids)
        unknown = wanted - {c.id for c in cases}
        if unknown:
            raise ValidationFailed("Unknown case id(s) for this suite", details={"case_ids": sorted(unknown)})
        cases = [c for c in cases if c.id in wanted]
    if model_mode == "scripted":
        cases = [c for c in cases if c.plan is not None and not c.use_model]
    return cases


async def evaluate_cases(plan: Sequence[PlannedCase], *, strategy: StrategyConfig | None, label: str,
                         model_mode: ModelMode = "scripted", run_tag: str = "adhoc",
                         on_score: ScoreCallback | None = None) -> list[tuple[EvaluationCase, int, CaseScore]]:
    harness = EvaluationHarness(model_mode=model_mode)
    scored: list[tuple[EvaluationCase, int, CaseScore]] = []
    for planned in plan:
        for repetition in range(max(1, planned.repetitions)):
            score = await harness.run_case(planned.case, strategy=strategy, label=label, run_tag=run_tag)
            logger.info("evaluation case scored", extra={"case": planned.case.id, "passed": score.passed,
                                                         "label": label})
            if on_score is not None:
                await on_score(planned.case, repetition, score)
            scored.append((planned.case, repetition, score))
    return scored


def result_row(row: EvaluationResult) -> ResultRow:
    return ResultRow(case_id=row.case_id, category=row.category, passed=row.passed,
                     false_completion=row.false_completion, unauthorized_action=row.unauthorized_action,
                     verification_passed=row.verification_passed, recovered=row.recovered,
                     tool_call_accuracy=row.tool_call_accuracy, latency_ms=row.latency_ms, cost_usd=row.cost_usd,
                     task_status=row.task_status)


async def load_results(run_id: uuid.UUID) -> list[EvaluationResult]:
    async with system_session() as session:
        return list((await session.execute(select(EvaluationResult).where(EvaluationResult.run_id == run_id)
                                           .order_by(EvaluationResult.created_at))).scalars().all())


async def create_run(*, suite: str, strategy: StrategyConfig | None, label: str, model_mode: ModelMode,
                     repetitions: int = 1, case_ids: Sequence[str] | None = None,
                     tenant_id: uuid.UUID | None = None, created_by: uuid.UUID | None = None,
                     experiment_id: uuid.UUID | None = None, variant: str | None = None) -> EvaluationRun:
    select_cases(suite, case_ids=case_ids, model_mode=model_mode)  # validate early
    async with system_session() as session:
        run = EvaluationRun(suite=suite, status=RunStatus.QUEUED, strategy_label=label[:80],
                            strategy_config=(strategy or StrategyConfig()).model_dump(mode="json"),
                            model=model_label(model_mode), repetitions=max(1, repetitions),
                            case_ids=list(case_ids) if case_ids else None, tenant_id=tenant_id,
                            created_by=created_by, experiment_id=experiment_id, variant=variant)
        session.add(run)
        await session.commit()
        return run


async def execute_run(run_id: uuid.UUID) -> EvaluationRun:
    """Execute a queued (or interrupted) run. A completed run is returned unchanged."""
    async with system_session() as session:
        run = await session.get(EvaluationRun, run_id, with_for_update=True)
        if run is None:
            raise NotFound("Evaluation run not found")
        if run.status == RunStatus.COMPLETED:
            await session.commit()
            return run
        await session.execute(delete(EvaluationResult).where(EvaluationResult.run_id == run_id))
        run.status = RunStatus.RUNNING
        run.started_at = utcnow()
        run.error = None
        await session.commit()
        suite, repetitions, case_ids = run.suite, run.repetitions, run.case_ids
        strategy = StrategyConfig.model_validate(run.strategy_config or {})
        label = run.strategy_label
        model_mode: ModelMode = "scripted" if run.model == "scripted" else "configured"

    async def persist(case: EvaluationCase, repetition: int, score: CaseScore) -> None:
        async with system_session() as s:
            s.add(EvaluationResult(
                run_id=run_id, case_id=case.id, repetition=repetition, category=case.category,
                passed=score.passed, task_status=score.task_status, false_completion=score.false_completion,
                unauthorized_action=score.unauthorized_action, verification_passed=score.verification_passed,
                recovered=score.recovered, tool_call_accuracy=score.tool_call_accuracy,
                latency_ms=score.latency_ms, cost_usd=score.cost_usd, details=score.details))
            await s.commit()

    try:
        cases = select_cases(suite, case_ids=case_ids, model_mode=model_mode)
        await evaluate_cases([PlannedCase(c, repetitions) for c in cases], strategy=strategy, label=label,
                             model_mode=model_mode, run_tag=str(run_id)[:8], on_score=persist)
    except Exception as exc:
        async with system_session() as session:
            failed = await session.get(EvaluationRun, run_id)
            if failed is not None:
                failed.status = RunStatus.FAILED
                failed.error = f"{type(exc).__name__}: {exc}"[:2000]
                failed.completed_at = utcnow()
                await session.commit()
        raise
    rows = [result_row(r) for r in await load_results(run_id)]
    async with system_session() as session:
        run = await session.get(EvaluationRun, run_id)
        assert run is not None
        run.metrics = aggregate(rows)
        run.status = RunStatus.COMPLETED
        run.completed_at = utcnow()
        await session.commit()
        return run


async def run_suite(suite: str, *, strategy: StrategyConfig | None = None, label: str = "baseline",
                    model_mode: ModelMode = "scripted", repetitions: int = 1,
                    case_ids: Sequence[str] | None = None, tenant_id: uuid.UUID | None = None,
                    created_by: uuid.UUID | None = None) -> EvaluationRun:
    """Create and execute a run in-process (CLI / tests). API callers enqueue ``evaluation.run`` instead."""
    run = await create_run(suite=suite, strategy=strategy, label=label, model_mode=model_mode,
                           repetitions=repetitions, case_ids=case_ids, tenant_id=tenant_id, created_by=created_by)
    return await execute_run(run.id)
