"""Baseline vs candidate on identical evaluation cases through the real stack, then the
promotion gate. The candidate's read-back tuning makes writes verifiable under provider lag."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from acbe_test_helpers import add_candidate
from sqlalchemy import select

from app.acbe.experiments import PromotionPolicy, run_experiment
from app.acbe.jobs import run_candidate_experiment
from app.acbe.models import StrategyCandidate, StrategyExperiment, StrategyResult, StrategyStatus
from app.core.database import get_session_factory, system_session
from app.evaluation.cases import acbe_suite, core_suite
from app.workers.jobs.registry import JobContext
from app.workers.queues.base import ClaimedJob

pytestmark = [pytest.mark.integration]


def _core(*ids: str) -> list[Any]:
    return [c for c in core_suite() if c.id in ids]


async def test_candidate_that_fixes_lagging_readback_passes_the_gate(acbe_user: Any) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id, status=StrategyStatus.DRAFT)
    policy = PromotionPolicy(min_sample_size=6, target_repetitions=3)
    experiment = await run_experiment(
        candidate.id, policy=policy,
        regression_cases=_core("core.happy_path", "core.prompt_injection_email", "core.verification_mismatch"))
    assert experiment is not None
    assert experiment.decision == "passed", experiment.decision_reason
    assert experiment.status == "completed" and experiment.experiment_version == 1
    assert experiment.baseline_metrics["task_success_rate"] == 0.5  # lag case fails, mismatch case behaves
    assert experiment.candidate_metrics["task_success_rate"] == 1.0
    assert experiment.candidate_metrics["unauthorized_action_rate"] == 0.0
    assert experiment.candidate_metrics["false_completion_rate"] == 0.0
    assert experiment.regression_metrics["candidate"]["task_success_rate"] == 1.0
    assert experiment.safety_checks["unauthorized_actions"]["ok"] is True
    assert experiment.safety_checks["regression"]["regressed"] == 0
    assert experiment.confidence is not None and experiment.confidence >= policy.confidence

    async with system_session() as s:
        refreshed = await s.get(StrategyCandidate, candidate.id)
        assert refreshed is not None and refreshed.status == "passed"
        results = (await s.execute(select(StrategyResult).where(
            StrategyResult.experiment_id == experiment.id))).scalars().all()
    # 2 target cases x 3 repetitions + 2 regression-only cases, for each variant.
    assert len(results) == 2 * (2 * 3 + 2)
    by_variant = {v: [r for r in results if r.variant == v] for v in ("baseline", "candidate")}
    assert all(r.success for r in by_variant["candidate"])
    lag = [r for r in by_variant["baseline"] if r.case_id == "acbe.calendar_readback_lag"]
    assert len(lag) == 3 and not any(r.success for r in lag)
    assert {r.details["strategy_label"] for r in by_variant["candidate"]} == {candidate.version_label}
    assert any(r.regression_case for r in results) and any(r.details["target"] for r in results)

    assert await run_experiment(candidate.id, policy=policy) is None  # already decided: idempotent


async def test_candidate_without_effect_is_rejected(acbe_user: Any, dedicated_evaluation_worker: str) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id, status=StrategyStatus.DRAFT, config={
        "planner_hints": ["Prefer calendar.find_free_slots for meeting times."]})
    experiment = await run_experiment(candidate.id, policy=PromotionPolicy(min_sample_size=2, target_repetitions=2),
                                      target_cases=acbe_suite(), regression_cases=[])
    assert experiment is not None
    assert experiment.decision == "rejected" and "gain" in (experiment.decision_reason or "")
    async with system_session() as s:
        refreshed = await s.get(StrategyCandidate, candidate.id)
        assert refreshed is not None and refreshed.status == "rejected"

    # The job on a dedicated evaluation worker is a no-op for an already-decided candidate.
    job = ClaimedJob(id=uuid.uuid4(), queue="evaluation", job_type="acbe.run_experiment",
                     payload={"candidate_id": str(candidate.id)}, attempts=1, max_attempts=3, tenant_id=None)
    await run_candidate_experiment(JobContext(job=job, worker_id=dedicated_evaluation_worker,
                                              session_factory=get_session_factory()), job.payload)
    async with system_session() as s:
        count = len((await s.execute(select(StrategyExperiment).where(
            StrategyExperiment.candidate_id == candidate.id))).scalars().all())
    assert count == 1
