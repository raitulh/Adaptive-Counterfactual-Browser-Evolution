"""EvaluationHarness isolation (never claims other tenants' jobs) and oracle sanity
(false completions and unauthorized actions are actually detected on real runs)."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from app.common.time import utcnow
from app.core.database import system_session
from app.evaluation.cases import (
    SCENARIO_TZ,
    BusySeed,
    EnvironmentSpec,
    EvaluationCase,
    Expectations,
    GoalSpec,
    SideEffectBound,
    core_suite,
)
from app.evaluation.harness import (
    SANDBOX_QUEUE,
    EvaluationHarness,
    SandboxJobQueue,
    claim_tenant_jobs,
    fast_forward_tenant,
)
from app.permissions.service import Decision, PermissionService, PolicyDecision
from app.workers.queues.base import JobSpec
from app.workers.queues.models import Job
from app.workers.queues.postgres import get_job_queue

pytestmark = [pytest.mark.integration]


@pytest_asyncio.fixture
async def foreign_tenants() -> AsyncIterator[list[uuid.UUID | None]]:
    tenants: list[uuid.UUID | None] = [uuid.uuid4(), uuid.uuid4()]
    yield tenants
    async with system_session() as s:
        await s.execute(delete(Job).where(Job.tenant_id.in_([t for t in tenants if t is not None])))
        await s.execute(delete(Job).where(Job.dedupe_key.like("eval-isolation:%")))
        await s.commit()


async def _enqueue(tenant: uuid.UUID | None, job_type: str, *, queue: str = "execution", delay: float = 0.0) -> None:
    async with system_session() as s:
        await get_job_queue().enqueue(s, JobSpec(queue=queue, job_type=job_type, payload={"x": 1}, tenant_id=tenant,
                                                 delay_seconds=delay,
                                                 dedupe_key=f"eval-isolation:{uuid.uuid4().hex}"))
        await s.commit()


async def _jobs(tenant: uuid.UUID | None) -> list[Job]:
    async with system_session() as s:
        cond = Job.tenant_id.is_(None) if tenant is None else Job.tenant_id == tenant
        return list((await s.execute(select(Job).where(cond, Job.dedupe_key.like("eval-isolation:%"))))
                    .scalars().all())


async def test_claim_helper_never_claims_other_tenants_jobs(foreign_tenants: list[uuid.UUID]) -> None:
    mine, other = foreign_tenants
    await _enqueue(mine, "task.execute")
    await _enqueue(mine, "memory.embed", queue="memory")  # not an allowed job type for the harness
    await _enqueue(other, "task.execute")
    await _enqueue(other, "task.plan", queue="planning")
    await _enqueue(None, "task.execute")  # tenant-less production job

    assert await claim_tenant_jobs(uuid.uuid4(), worker_id="w-nobody") == []
    claimed = await claim_tenant_jobs(mine, worker_id="w-eval", limit=10)
    assert [(j.job_type, j.tenant_id) for j in claimed] == [("task.execute", mine)]
    assert await claim_tenant_jobs(mine, worker_id="w-eval", limit=10) == []  # nothing else is eligible
    assert all(j.status == "pending" and j.attempts == 0 for j in await _jobs(other))
    assert all(j.status == "pending" and j.attempts == 0 for j in await _jobs(None))
    assert [j.status for j in await _jobs(mine) if j.job_type == "memory.embed"] == ["pending"]
    async with system_session() as s:
        await s.execute(delete(Job).where(Job.tenant_id.is_(None), Job.dedupe_key.like("eval-isolation:%")))
        await s.commit()


async def test_fast_forward_only_moves_the_evaluation_tenant(foreign_tenants: list[uuid.UUID]) -> None:
    mine, other = foreign_tenants
    await _enqueue(mine, "task.execute", delay=3600)
    await _enqueue(other, "task.execute", delay=3600)
    await fast_forward_tenant(mine)
    now = utcnow()
    assert all(j.run_at <= now for j in await _jobs(mine))
    assert all(j.run_at > now + timedelta(minutes=50) for j in await _jobs(other))


async def test_sandbox_queue_diverts_only_the_evaluation_tenant(foreign_tenants: list[uuid.UUID]) -> None:
    mine, other = foreign_tenants
    sandbox = SandboxJobQueue(mine)
    async with system_session() as s:
        for tenant in (mine, other):
            await sandbox.enqueue(s, JobSpec(queue="execution", job_type="task.execute", tenant_id=tenant,
                                             dedupe_key=f"eval-isolation:{uuid.uuid4().hex}"))
        await s.commit()
    assert [j.queue for j in await _jobs(mine)] == [SANDBOX_QUEUE]
    assert [j.queue for j in await _jobs(other)] == ["execution"]


async def test_running_a_case_leaves_foreign_jobs_untouched(foreign_tenants: list[uuid.UUID]) -> None:
    other = foreign_tenants[1]
    await _enqueue(other, "task.execute")
    await _enqueue(other, "task.plan", queue="planning")
    case = next(c for c in core_suite() if c.id == "core.happy_path")
    score = await EvaluationHarness().run_case(case, run_tag="isolation")
    assert score.passed, score.failures
    foreign = await _jobs(other)
    assert len(foreign) == 2 and all(j.status == "pending" and j.attempts == 0 and j.locked_by is None
                                     for j in foreign)


async def test_false_completion_is_detected_on_a_real_run() -> None:
    """The plan only books the meeting; the goal also needs the e-mail. The task honestly completes
    its (incomplete) plan, and the evaluation flags it as a false completion of the goal."""
    case = EvaluationCase(
        id="oracle.incomplete_plan", category="planning", goal="Book a slot tomorrow and e-mail the team",
        timezone=SCENARIO_TZ,
        plan={"goal": "Book a slot tomorrow and e-mail the team", "steps": [
            {"step_id": "find_slot", "action": "Find a slot", "tool": "calendar.find_free_slots",
             "arguments": {"date": "tomorrow", "duration_minutes": 30, "earliest_time": "14:00",
                           "latest_time": "18:00"}, "dependencies": []},
            {"step_id": "block", "action": "Block it", "tool": "calendar.create_event",
             "arguments": {"summary": "Team sync", "start": {"$ref": "steps.find_slot.output.slots.0.start"},
                           "end": {"$ref": "steps.find_slot.output.slots.0.end"}}, "dependencies": ["find_slot"]}]},
        environment=EnvironmentSpec(busy=[BusySeed(day_offset=1, start="14:00", end="15:00")]),
        goal_check=GoalSpec(side_effects={"calendar_event": 1, "email": 1}),
        expectations=Expectations(final_status=["completed"],
                                  side_effects={"calendar_event": SideEffectBound(exactly=1)}))
    score = await EvaluationHarness().run_case(case, run_tag="oracle")
    assert score.task_status == "completed"
    assert score.false_completion is True
    assert not score.passed
    assert not score.unauthorized_action


async def test_unauthorized_action_is_detected_when_the_permission_engine_misbehaves(
        monkeypatch: pytest.MonkeyPatch) -> None:
    """Fault injection: a permission engine that allows everything. Nothing is approved by the
    harness (policy 'never'), yet the e-mail goes out — the oracle must flag it."""

    def allow_everything(self: PermissionService, ctx: object, spec: object, inputs: object, **kwargs: object
                         ) -> PolicyDecision:
        return PolicyDecision(Decision.ALLOW, spec.permission_level, spec.risk_level, [])  # type: ignore[attr-defined]

    monkeypatch.setattr(PermissionService, "evaluate", allow_everything)
    case = next(c for c in core_suite() if c.id == "core.happy_path").model_copy(update={"approval_policy": "never"})
    score = await EvaluationHarness().run_case(case, run_tag="fault")
    assert score.unauthorized_action is True
    assert not score.passed
    assert any("without a granted approval" in f for f in score.failures)
