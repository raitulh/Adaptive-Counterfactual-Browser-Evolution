"""Scheduler materialization, retries, access re-validation and run-outcome sync."""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.audit.models import AuditLog
from app.automations.models import Automation, AutomationRun
from app.automations.service import enqueue_due_automations, sync_run_outcomes
from app.common.time import ensure_aware, utcnow
from app.notifications.models import Notification
from app.organizations.models import OrganizationMember
from app.tasks.models import Task
from app.usage.models import UsageEvent
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration


async def _tick(sf, now=None) -> int:
    async with sf() as s:
        s.info["system"] = True
        return await enqueue_due_automations(s, now=now or utcnow())


async def _sync(sf) -> int:
    async with sf() as s:
        s.info["system"] = True
        return await sync_run_outcomes(s)


async def _load(sf, model, **where):
    async with sf() as s:
        s.info["system"] = True
        stmt = select(model)
        for key, value in where.items():
            stmt = stmt.where(getattr(model, key) == value)
        return list((await s.execute(stmt)).scalars().all())


async def _one(sf, model, **where):
    rows = await _load(sf, model, **where)
    assert len(rows) == 1, rows
    return rows[0]


async def _set_task_status(sf, task_id: uuid.UUID, status: str, failure_code: str | None = None) -> None:
    async with sf() as s:
        s.info["system"] = True
        await s.execute(update(Task).where(Task.id == task_id).values(status=status, failure_code=failure_code))
        await s.commit()


async def _make_due(sf, automation_id: uuid.UUID, minutes_ago: int) -> None:
    async with sf() as s:
        s.info["system"] = True
        await s.execute(update(Automation).where(Automation.id == automation_id).values(
            enabled=True, next_run_at=utcnow() - timedelta(minutes=minutes_ago)))
        await s.commit()


# ---------------------------------------------------------------------------- materialization
async def test_due_automation_creates_automation_task_and_plan_job(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id, cron="0 9 * * *",
                                       goal="Check my calendar for tomorrow")
    now = utcnow()
    assert await _tick(sf, now) >= 1

    run = await _one(sf, AutomationRun, automation_id=automation.id)
    assert run.status == "created" and run.trigger == "schedule" and run.task_id is not None
    assert ensure_aware(run.scheduled_for) == ensure_aware(automation.next_run_at)
    task = await _one(sf, Task, id=run.task_id)
    assert task.source == "automation"
    assert task.automation_run_id == run.id
    assert task.user_id == user.user_id and task.tenant_id == user.tenant_id
    assert task.goal == "Check my calendar for tomorrow"
    assert task.status == "created"  # the scheduler never runs the workflow itself
    assert task.idempotency_key == f"automation:{automation.id}:{ensure_aware(run.scheduled_for).isoformat()}"
    plan_job = await _one(sf, Job, dedupe_key=f"plan:{task.id}")
    assert plan_job.job_type == "task.plan" and plan_job.status == "pending"
    usage = await _load(sf, UsageEvent, task_id=task.id, kind="automation_run")
    assert len(usage) == 1

    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.run_count == 1 and fresh.last_status == "created" and fresh.last_run_at is not None
    assert fresh.enabled is True
    assert ensure_aware(fresh.next_run_at) > now


async def test_concurrent_schedulers_materialize_exactly_once(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id, cron="0 9 * * *")
    now = utcnow()
    await asyncio.gather(*[_tick(sf, now) for _ in range(6)])
    await _tick(sf, now)  # a later tick finds nothing due for this automation

    runs = await _load(sf, AutomationRun, automation_id=automation.id)
    assert len(runs) == 1
    async with sf() as s:
        s.info["system"] = True
        tasks = (await s.execute(select(func.count()).select_from(Task).where(
            Task.automation_run_id == runs[0].id))).scalar_one()
    assert tasks == 1
    assert (await _one(sf, Automation, id=automation.id)).run_count == 1


async def test_outage_produces_at_most_one_catch_up_run(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id, cron="0 * * * *",
                                       next_run_at=utcnow() - timedelta(days=3))
    now = utcnow()
    await _tick(sf, now)
    await _tick(sf, now)
    assert len(await _load(sf, AutomationRun, automation_id=automation.id)) == 1
    fresh = await _one(sf, Automation, id=automation.id)
    assert now < ensure_aware(fresh.next_run_at) <= now + timedelta(hours=1)


async def test_max_runs_disables_the_automation(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id, max_runs=1)
    await _tick(sf)
    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.run_count == 1
    assert fresh.enabled is False and fresh.next_run_at is None and fresh.disabled_reason == "max_runs_reached"


@pytest.mark.parametrize("change", ["removed", "viewer"])
async def test_lost_membership_skips_run_and_disables(sf, register_user, make_automation, add_member, change):
    owner = await register_user()
    member = await register_user()
    await add_member(owner.tenant_id, member.user_id, role="viewer" if change == "viewer" else "member")
    automation = await make_automation(owner.tenant_id, member.user_id)
    if change == "removed":
        async with sf() as s:
            s.info["system"] = True
            membership = (await s.execute(select(OrganizationMember).where(
                OrganizationMember.tenant_id == owner.tenant_id,
                OrganizationMember.user_id == member.user_id))).scalar_one()
            await s.delete(membership)
            await s.commit()

    await _tick(sf)

    run = await _one(sf, AutomationRun, automation_id=automation.id)
    assert run.status == "skipped" and run.error == "owner_access_lost" and run.task_id is None
    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.enabled is False and fresh.disabled_reason == "owner_access_lost" and fresh.next_run_at is None
    assert await _load(sf, Task, user_id=member.user_id, tenant_id=owner.tenant_id) == []
    audits = await _load(sf, AuditLog, resource_id=str(automation.id), action="automation.disabled")
    assert len(audits) == 1 and audits[0].metadata_["reason"] == "owner_access_lost"


async def test_transient_failure_is_retried_with_backoff(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id,
                                       retry_policy={"max_attempts": 3, "backoff_seconds": 60})
    async with sf() as s:  # the free plan allows 3 concurrently active tasks
        s.info["system"] = True
        blockers = [Task(tenant_id=user.tenant_id, user_id=user.user_id, goal=f"busy {i}", status="queued")
                    for i in range(3)]
        s.add_all(blockers)
        await s.commit()
    now = utcnow()
    await _tick(sf, now)

    run = await _one(sf, AutomationRun, automation_id=automation.id)
    assert run.status == "created" and run.task_id is None
    assert run.error == "too_many_active_tasks" and run.attempts == 1
    assert ensure_aware(run.next_attempt_at) == now + timedelta(seconds=60)
    assert (await _one(sf, Automation, id=automation.id)).consecutive_failures == 0

    await _tick(sf, now + timedelta(seconds=30))  # not yet due for retry
    assert (await _one(sf, AutomationRun, id=run.id)).attempts == 1

    for blocker in blockers:
        await _set_task_status(sf, blocker.id, "completed")
    await _tick(sf, now + timedelta(seconds=61))
    run = await _one(sf, AutomationRun, id=run.id)
    assert run.task_id is not None and run.status == "created" and run.attempts == 2
    assert run.error is None and run.next_attempt_at is None
    assert (await _one(sf, Task, id=run.task_id)).source == "automation"


async def test_exhausted_retries_fail_the_run(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id,
                                       retry_policy={"max_attempts": 1, "backoff_seconds": 60})
    async with sf() as s:
        s.info["system"] = True
        s.add_all([Task(tenant_id=user.tenant_id, user_id=user.user_id, goal="busy", status="running")
                   for _ in range(3)])
        await s.commit()
    await _tick(sf)
    run = await _one(sf, AutomationRun, automation_id=automation.id)
    assert run.status == "failed" and run.error == "too_many_active_tasks" and run.finished_at is not None
    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.consecutive_failures == 1 and fresh.enabled is True
    notes = await _load(sf, Notification, user_id=user.user_id, event_type="automation_failed")
    assert len(notes) == 1


# ---------------------------------------------------------------------------- outcome sync
async def test_pause_after_consecutive_failures(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id,
                                       policy={"pause_on_failure": True, "max_consecutive_failures": 2})
    await _tick(sf)
    run1 = await _one(sf, AutomationRun, automation_id=automation.id)
    await _set_task_status(sf, run1.task_id, "failed", "tool_unavailable")
    await _sync(sf)

    run1 = await _one(sf, AutomationRun, id=run1.id)
    assert run1.status == "failed" and run1.error == "tool_unavailable" and run1.finished_at is not None
    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.consecutive_failures == 1 and fresh.enabled is True and fresh.last_status == "failed"
    notes = await _load(sf, Notification, user_id=user.user_id, event_type="automation_failed")
    assert len(notes) == 1 and notes[0].data["run_id"] == str(run1.id) and notes[0].data["paused"] is False

    await _make_due(sf, automation.id, minutes_ago=2)
    await _tick(sf)
    runs = await _load(sf, AutomationRun, automation_id=automation.id)
    run2 = next(r for r in runs if r.id != run1.id)
    await _set_task_status(sf, run2.task_id, "failed", "verification_failed")
    await _sync(sf)
    await _sync(sf)  # idempotent

    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.consecutive_failures == 2
    assert fresh.enabled is False and fresh.disabled_reason == "paused_after_failures" and fresh.next_run_at is None
    notes = await _load(sf, Notification, user_id=user.user_id, event_type="automation_failed")
    assert len(notes) == 2
    assert any(n.data["paused"] is True and "paused" in n.title for n in notes)
    assert len(await _load(sf, AuditLog, resource_id=str(automation.id), action="automation.paused")) == 1


async def test_success_resets_failures_and_cancellation_is_not_a_malfunction(sf, register_user,
                                                                             make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id)
    await _tick(sf)
    run1 = await _one(sf, AutomationRun, automation_id=automation.id)
    await _set_task_status(sf, run1.task_id, "failed", "boom")
    await _sync(sf)
    assert (await _one(sf, Automation, id=automation.id)).consecutive_failures == 1

    await _make_due(sf, automation.id, minutes_ago=2)
    await _tick(sf)
    run2 = next(r for r in await _load(sf, AutomationRun, automation_id=automation.id) if r.id != run1.id)
    await _set_task_status(sf, run2.task_id, "cancelled")
    await _sync(sf)
    run2 = await _one(sf, AutomationRun, id=run2.id)
    assert run2.status == "failed" and run2.error == "task_cancelled"
    assert (await _one(sf, Automation, id=automation.id)).consecutive_failures == 1

    await _make_due(sf, automation.id, minutes_ago=3)
    await _tick(sf)
    run3 = next(r for r in await _load(sf, AutomationRun, automation_id=automation.id)
                if r.id not in (run1.id, run2.id))
    await _set_task_status(sf, run3.task_id, "completed")
    await _sync(sf)
    assert (await _one(sf, AutomationRun, id=run3.id)).status == "succeeded"
    fresh = await _one(sf, Automation, id=automation.id)
    assert fresh.consecutive_failures == 0 and fresh.last_status == "succeeded"
    assert len(await _load(sf, Notification, user_id=user.user_id, event_type="automation_failed")) == 1


async def test_open_runs_stay_open_until_the_task_settles(sf, register_user, make_automation):
    user = await register_user()
    automation = await make_automation(user.tenant_id, user.user_id)
    await _tick(sf)
    run = await _one(sf, AutomationRun, automation_id=automation.id)
    for status in ("planning", "running", "waiting_approval"):
        await _set_task_status(sf, run.task_id, status)
        await _sync(sf)
        assert (await _one(sf, AutomationRun, id=run.id)).status == "created"
