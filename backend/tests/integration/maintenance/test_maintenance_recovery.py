"""maintenance.recover_stalled_tasks: truthful dead-letter failure and orphan re-enqueueing."""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, text

from app.audit.models import AuditLog
from app.common.time import utcnow
from app.notifications.models import Notification
from app.tasks.models import Task, TaskEvent
from app.workers.jobs.maintenance import recover_stalled_tasks
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration


async def _task(sf, user, status: str, *, idle_minutes: int = 10, lease_minutes: int | None = None) -> Task:
    """A task last touched ``idle_minutes`` ago; ``lease_minutes`` sets a lease relative to now."""
    async with sf() as s:
        s.info["system"] = True
        task = Task(tenant_id=user.tenant_id, user_id=user.user_id, goal="Send the weekly report", status=status,
                    lease_owner="worker-gone" if lease_minutes is not None else None,
                    lease_expires_at=utcnow() + timedelta(minutes=lease_minutes) if lease_minutes is not None
                    else None)
        s.add(task)
        await s.commit()
        await s.execute(text("UPDATE tasks SET updated_at = now() - make_interval(mins => :m) WHERE id = :id"),
                        {"m": idle_minutes, "id": task.id})
        await s.commit()
        return task


async def _job(sf, task: Task, *, job_type: str = "task.execute", status: str = "dead",
               finished_minutes_ago: int = 1) -> Job:
    queue, prefix = ("execution", "task") if job_type == "task.execute" else ("planning", "plan")
    async with sf() as s:
        s.info["system"] = True
        job = Job(queue=queue, job_type=job_type, payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                  status=status, dedupe_key=f"{prefix}:{task.id}", tenant_id=task.tenant_id, attempts=5,
                  max_attempts=5, last_error="boom",
                  finished_at=utcnow() - timedelta(minutes=finished_minutes_ago) if status != "pending" else None)
        s.add(job)
        await s.commit()
        return job


async def _jobs(sf, task_id: uuid.UUID, status: str | None = None) -> list[Job]:
    async with sf() as s:
        s.info["system"] = True
        stmt = select(Job).where(Job.payload["task_id"].astext == str(task_id))
        if status:
            stmt = stmt.where(Job.status == status)
        return list((await s.execute(stmt.order_by(Job.created_at))).scalars().all())


async def _fresh(sf, task_id: uuid.UUID) -> Task:
    async with sf() as s:
        s.info["system"] = True
        task = await s.get(Task, task_id)
        assert task is not None
        return task


async def _events(sf, task_id: uuid.UUID) -> list[str]:
    async with sf() as s:
        s.info["system"] = True
        return list((await s.execute(select(TaskEvent.event_type).where(TaskEvent.task_id == task_id)
                                     .order_by(TaskEvent.seq))).scalars().all())


async def test_orphaned_running_task_is_reenqueued_once(sf, register_user):
    user = await register_user()
    task = await _task(sf, user, "running", lease_minutes=-10)  # its worker died 10 minutes ago

    await recover_stalled_tasks(sf)
    pending = await _jobs(sf, task.id, "pending")
    assert len(pending) == 1
    assert pending[0].job_type == "task.execute" and pending[0].dedupe_key == f"task:{task.id}"
    assert pending[0].payload == {"task_id": str(task.id), "tenant_id": str(task.tenant_id)}
    assert "RECOVERY_STARTED" in await _events(sf, task.id)
    assert (await _fresh(sf, task.id)).status == "running"  # the engine resumes it; no state is invented

    await recover_stalled_tasks(sf)  # the pending job now covers it
    assert len(await _jobs(sf, task.id)) == 1


@pytest.mark.parametrize("status", ["queued", "recovering", "verifying", "cancel_requested"])
async def test_other_execution_states_are_recovered(sf, register_user, status):
    user = await register_user()
    task = await _task(sf, user, status)
    await recover_stalled_tasks(sf)
    assert [j.job_type for j in await _jobs(sf, task.id, "pending")] == ["task.execute"]


async def test_healthy_tasks_are_left_alone(sf, register_user):
    user = await register_user()
    leased = await _task(sf, user, "running", lease_minutes=1)  # a live worker holds the lease
    recent = await _task(sf, user, "queued", idle_minutes=0)  # changed moments ago
    covered = await _task(sf, user, "queued")
    await _job(sf, covered, status="pending")  # a job is already waiting
    running_job = await _task(sf, user, "running", lease_minutes=-10)
    await _job(sf, running_job, status="running")
    resting = await _task(sf, user, "waiting_approval")

    await recover_stalled_tasks(sf)
    for task in (leased, recent, resting):
        assert await _jobs(sf, task.id) == []
    assert len(await _jobs(sf, covered.id)) == 1
    assert len(await _jobs(sf, running_job.id)) == 1


async def test_stalled_planning_is_replanned_in_recover_mode(sf, register_user):
    user = await register_user()
    planning = await _task(sf, user, "planning", idle_minutes=6)
    young = await _task(sf, user, "planning", idle_minutes=3)
    await recover_stalled_tasks(sf)
    jobs = await _jobs(sf, planning.id, "pending")
    assert len(jobs) == 1 and jobs[0].job_type == "task.plan" and jobs[0].payload["mode"] == "recover"
    assert jobs[0].dedupe_key == f"plan:{planning.id}"
    assert await _jobs(sf, young.id) == []


async def test_dead_lettered_execution_fails_the_task_truthfully(sf, register_user):
    user = await register_user()
    task = await _task(sf, user, "running", lease_minutes=-10)
    dead = await _job(sf, task)

    report = await recover_stalled_tasks(sf)
    assert report.errors == 0
    fresh = await _fresh(sf, task.id)
    assert fresh.status == "failed" and fresh.failure_code == "worker_dead_letter"
    assert "failed repeatedly" in (fresh.failure_message or "")
    assert fresh.completed_at is not None and fresh.lease_owner is None
    assert "TASK_FAILED" in await _events(sf, task.id)
    assert [j.id for j in await _jobs(sf, task.id)] == [dead.id]  # not re-enqueued into the same crash

    async with sf() as s:
        s.info["system"] = True
        notes = (await s.execute(select(Notification).where(Notification.user_id == user.user_id,
                                                            Notification.event_type == "task_failed"))
                 ).scalars().all()
        audits = (await s.execute(select(AuditLog).where(AuditLog.task_id == task.id,
                                                         AuditLog.action == "task.failed"))).scalars().all()
    assert len(notes) == 1 and notes[0].data["code"] == "worker_dead_letter"
    assert len(audits) == 1

    await recover_stalled_tasks(sf)  # idempotent
    assert (await _fresh(sf, task.id)).status == "failed"
    assert (await _events(sf, task.id)).count("TASK_FAILED") == 1


async def test_dead_lettered_planning_fails_the_task(sf, register_user):
    user = await register_user()
    task = await _task(sf, user, "planning")
    await _job(sf, task, job_type="task.plan")
    await recover_stalled_tasks(sf)
    fresh = await _fresh(sf, task.id)
    assert fresh.status == "failed" and fresh.failure_code == "worker_dead_letter"
    assert await _jobs(sf, task.id, "pending") == []


async def test_old_dead_letter_superseded_by_a_newer_job_is_ignored(sf, register_user):
    user = await register_user()
    task = await _task(sf, user, "queued", idle_minutes=1)
    await _job(sf, task, finished_minutes_ago=30)
    await _job(sf, task, status="succeeded")  # the task was resumed and ran again since
    await recover_stalled_tasks(sf)
    assert (await _fresh(sf, task.id)).status == "queued"
