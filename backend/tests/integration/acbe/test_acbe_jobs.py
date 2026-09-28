"""``acbe.analyze_task_failures``: verified failures → significant pattern → draft candidate +
experiment job; idempotent, flag-gated, blind to evaluation tasks."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from acbe_test_helpers import add_failed_task
from sqlalchemy import select

from app.acbe.jobs import analyze_task_failures, run_candidate_experiment
from app.acbe.models import StrategyCandidate
from app.common.feature_flags import Flags, clear_cache
from app.common.models import FeatureFlag
from app.core.database import get_session_factory, system_session
from app.workers.jobs.registry import JobContext
from app.workers.queues.base import ClaimedJob, DeferJob
from app.workers.queues.models import Job

pytestmark = [pytest.mark.integration]


def _ctx(job_type: str, payload: dict[str, Any], worker_id: str = "general-worker") -> JobContext:
    job = ClaimedJob(id=uuid.uuid4(), queue="evaluation", job_type=job_type, payload=payload, attempts=1,
                     max_attempts=5, tenant_id=None)
    return JobContext(job=job, worker_id=worker_id, session_factory=get_session_factory())


async def _analyze(tenant_id: uuid.UUID, task_id: uuid.UUID) -> None:
    payload = {"task_id": str(task_id), "tenant_id": str(tenant_id)}
    await analyze_task_failures(_ctx("acbe.analyze_task_failures", payload), payload)


async def _candidates(tenant_id: uuid.UUID) -> list[StrategyCandidate]:
    async with system_session() as s:
        return list((await s.execute(select(StrategyCandidate).where(StrategyCandidate.tenant_id == tenant_id)))
                    .scalars().all())


async def test_significant_pattern_creates_one_draft_candidate_and_experiment_job(acbe_user: Any) -> None:
    owner = await acbe_user()
    fingerprint = uuid.uuid4().hex
    first, _ = await add_failed_task(owner, fingerprint=fingerprint)
    await _analyze(owner.tenant_id, first)
    assert await _candidates(owner.tenant_id) == []  # one task is not a pattern yet
    await add_failed_task(owner, fingerprint=fingerprint, source="evaluation")  # evaluation tasks never count
    await _analyze(owner.tenant_id, first)
    assert await _candidates(owner.tenant_id) == []
    ids: list[str] = []
    for _ in range(2):
        _, record_ids = await add_failed_task(owner, fingerprint=fingerprint, failures=2)
        ids += record_ids
    await _analyze(owner.tenant_id, first)

    (candidate,) = await _candidates(owner.tenant_id)
    assert candidate.status == "draft"
    assert candidate.version_label == f"acbe-{fingerprint[:8]}-1"
    assert candidate.failure_type == "VERIFICATION_FAILURE" and candidate.scope == "tool:calendar.create_event"
    assert candidate.candidate_config["verification_readback"]["calendar.create_event"] == {"attempts": 5,
                                                                                         "delay_ms": 500}
    assert candidate.failed_strategy["version"] == "baseline"
    assert set(ids) <= set(candidate.source_failure_ids)
    async with system_session() as s:
        jobs = [j for j in (await s.execute(select(Job).where(Job.job_type == "acbe.run_experiment"))).scalars()
                if j.payload.get("candidate_id") == str(candidate.id)]
    assert len(jobs) == 1 and jobs[0].queue == "evaluation" and jobs[0].tenant_id == owner.tenant_id

    await _analyze(owner.tenant_id, first)  # re-delivery / later failures: no duplicate candidate
    assert len(await _candidates(owner.tenant_id)) == 1


async def test_unlearnable_and_disabled_tenants_create_nothing(acbe_user: Any) -> None:
    owner = await acbe_user()
    auth_fp = uuid.uuid4().hex
    task_id = uuid.uuid4()
    for _ in range(4):
        task_id, _ = await add_failed_task(owner, fingerprint=auth_fp, error_class="auth_expired",
                                           error_code="integration_expired", tool="calendar.find_free_slots")
    await _analyze(owner.tenant_id, task_id)
    assert await _candidates(owner.tenant_id) == []

    disabled = await acbe_user()
    async with system_session() as s:
        s.add(FeatureFlag(key=Flags.ACBE, tenant_id=disabled.tenant_id, enabled=False))
        await s.commit()
    clear_cache()
    try:
        fp = uuid.uuid4().hex
        for _ in range(3):
            task_id, _ = await add_failed_task(disabled, fingerprint=fp)
        await _analyze(disabled.tenant_id, task_id)
        assert await _candidates(disabled.tenant_id) == []
    finally:
        clear_cache()

    await _analyze(owner.tenant_id, uuid.uuid4())  # unknown task: nothing to do, no error


async def test_experiment_job_only_runs_on_a_dedicated_evaluation_worker() -> None:
    payload = {"candidate_id": str(uuid.uuid4())}
    with pytest.raises(DeferJob):
        await run_candidate_experiment(_ctx("acbe.run_experiment", payload), payload)
