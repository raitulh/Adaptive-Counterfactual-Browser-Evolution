"""maintenance.retention / maintenance.cleanup_jobs and the audit append-only escape hatch."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta

import pytest
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.audit.models import AuditLog
from app.automations.models import Automation, AutomationRun
from app.common.ids import new_id
from app.common.models import ApiIdempotencyKey, OutboxEvent, WebhookDelivery
from app.common.time import utcnow
from app.notifications.models import Notification
from app.tasks.models import ExecutionLog, Task, TaskEvent
from app.usage.models import UsageEvent
from app.workers.jobs.maintenance import cleanup_jobs, run_retention
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration


def _ago(days: float) -> datetime:
    return utcnow() - timedelta(days=days)


async def _exists(sf, model, row_id) -> bool:
    async with sf() as s:
        s.info["system"] = True
        return (await s.execute(select(model.id).where(model.id == row_id))).scalar_one_or_none() is not None


async def _add(sf, *rows):
    async with sf() as s:
        s.info["system"] = True
        s.add_all(rows)
        await s.commit()
    return rows


async def _task(sf, user, status: str, *, age_days: float) -> Task:
    (task,) = await _add(sf, Task(tenant_id=user.tenant_id, user_id=user.user_id, goal="g", status=status,
                                  completed_at=_ago(age_days) if status in ("completed", "failed") else None))
    async with sf() as s:
        await s.execute(text("UPDATE tasks SET updated_at = :at WHERE id = :id"), {"at": _ago(age_days), "id": task.id})
        await s.commit()
    return task


def _event(task: Task, seq: int, age_days: float) -> TaskEvent:
    return TaskEvent(tenant_id=task.tenant_id, task_id=task.id, seq=seq, event_type="TASK_STATE_CHANGED",
                     created_at=_ago(age_days))


async def test_retention_deletes_old_rows_and_keeps_recent_ones(sf, register_user, audit_append_only):
    user = await register_user()
    tid, uid = user.tenant_id, user.user_id

    old_done = await _task(sf, user, "completed", age_days=200)
    old_failed = await _task(sf, user, "failed", age_days=200)
    active = await _task(sf, user, "running", age_days=200)
    recently_done = await _task(sf, user, "completed", age_days=1)
    ev_old_done, ev_old_failed, ev_active, ev_recent_task = await _add(
        sf, _event(old_done, 1, 200), _event(old_failed, 1, 200), _event(active, 1, 200),
        _event(recently_done, 1, 200))
    ev_new = (await _add(sf, _event(recently_done, 2, 0)))[0]

    log_old, log_new = await _add(
        sf, ExecutionLog(tenant_id=tid, task_id=active.id, message="old", created_at=_ago(91)),
        ExecutionLog(tenant_id=tid, task_id=active.id, message="new", created_at=_ago(1)))
    note_old, note_new = await _add(
        sf, Notification(tenant_id=tid, user_id=uid, event_type="task_completed", title="old",
                         idempotency_key=f"old-{new_id()}", created_at=_ago(91)),
        Notification(tenant_id=tid, user_id=uid, event_type="task_completed", title="new",
                     idempotency_key=f"new-{new_id()}", created_at=_ago(1)))
    out_old, out_new, out_unpublished = await _add(
        sf, OutboxEvent(topic="t", event_type="E", payload={}, published_at=_ago(2), created_at=_ago(2)),
        OutboxEvent(topic="t", event_type="E", payload={}, published_at=_ago(0.01)),
        OutboxEvent(topic="t", event_type="E", payload={}, created_at=_ago(5)))
    key_expired, key_valid = await _add(
        sf, ApiIdempotencyKey(tenant_id=tid, user_id=uid, key=f"k-{new_id()}", method="POST", path="/x",
                              request_hash="h", expires_at=_ago(0.01)),
        ApiIdempotencyKey(tenant_id=tid, user_id=uid, key=f"k-{new_id()}", method="POST", path="/x",
                          request_hash="h", expires_at=_ago(-1)))
    hook_old, hook_new = await _add(
        sf, WebhookDelivery(provider="test", delivery_id=f"d-{new_id()}", received_at=_ago(31)),
        WebhookDelivery(provider="test", delivery_id=f"d-{new_id()}", received_at=_ago(1)))
    usage_old, usage_new = await _add(
        sf, UsageEvent(tenant_id=tid, user_id=uid, kind="tool_call", occurred_at=_ago(401)),
        UsageEvent(tenant_id=tid, user_id=uid, kind="tool_call", occurred_at=_ago(1)))
    audit_old, audit_new = await _add(
        sf, AuditLog(tenant_id=tid, user_id=uid, category="task", action="task.create", created_at=_ago(800)),
        AuditLog(tenant_id=tid, user_id=uid, category="task", action="task.create", created_at=_ago(1)))
    (automation,) = await _add(sf, Automation(tenant_id=tid, user_id=uid, name="a", cron_expression="0 0 1 1 *",
                                              task_template={"goal": "g"}, enabled=False))
    run_old_done, run_old_open, run_new = await _add(
        sf, AutomationRun(tenant_id=tid, automation_id=automation.id, scheduled_for=_ago(400), status="succeeded",
                          created_at=_ago(400)),
        AutomationRun(tenant_id=tid, automation_id=automation.id, scheduled_for=_ago(399), status="created",
                      created_at=_ago(399)),
        AutomationRun(tenant_id=tid, automation_id=automation.id, scheduled_for=_ago(1), status="failed",
                      created_at=_ago(1)))

    report = await run_retention(sf, batch_size=2, max_batches=10_000)
    assert not [e for e in report.errors if e != "browser_artifacts"], report.errors

    deleted = [(TaskEvent, ev_old_done), (TaskEvent, ev_old_failed), (ExecutionLog, log_old),
               (Notification, note_old), (OutboxEvent, out_old), (ApiIdempotencyKey, key_expired),
               (WebhookDelivery, hook_old), (UsageEvent, usage_old), (AuditLog, audit_old),
               (AutomationRun, run_old_done)]
    kept = [(TaskEvent, ev_active), (TaskEvent, ev_recent_task), (TaskEvent, ev_new), (ExecutionLog, log_new),
            (Notification, note_new), (OutboxEvent, out_new), (OutboxEvent, out_unpublished),
            (ApiIdempotencyKey, key_valid), (WebhookDelivery, hook_new), (UsageEvent, usage_new),
            (AuditLog, audit_new), (AutomationRun, run_old_open), (AutomationRun, run_new)]
    for model, row in deleted:
        assert not await _exists(sf, model, row.id), (model.__name__, "should be deleted")
    for model, row in kept:
        assert await _exists(sf, model, row.id), (model.__name__, "should be kept")
    assert report.deleted["audit_logs"] >= 1 and report.deleted["task_events"] >= 2

    async with sf() as s:
        s.info["system"] = True
        purges = (await s.execute(select(AuditLog).where(AuditLog.action == "audit.retention_purged"))
                  ).scalars().all()
    assert purges and all(p.metadata_["count"] >= 1 for p in purges)

    again = await run_retention(sf)  # idempotent: nothing left to delete for these rows
    assert not [e for e in again.errors if e != "browser_artifacts"]


async def test_audit_rows_are_deletable_only_through_the_escape_hatch(sf, register_user, audit_append_only):
    user = await register_user()
    (row,) = await _add(sf, AuditLog(tenant_id=user.tenant_id, user_id=user.user_id, category="security",
                                     action="login", created_at=_ago(900)))
    for statement in ("DELETE FROM audit_logs WHERE id = :id",
                      "UPDATE audit_logs SET action = 'tampered' WHERE id = :id"):
        async with sf() as s:
            with pytest.raises(DBAPIError, match="append-only"):
                await s.execute(text(statement), {"id": row.id})
            await s.rollback()
    async with sf() as s:  # the flag does not permit rewriting history
        await s.execute(text("SET LOCAL agentos.audit_retention = 'on'"))
        with pytest.raises(DBAPIError, match="append-only"):
            await s.execute(text("UPDATE audit_logs SET action = 'tampered' WHERE id = :id"), {"id": row.id})
        await s.rollback()
    async with sf() as s:  # SET LOCAL is scoped to its own transaction
        await s.execute(text("SET LOCAL agentos.audit_retention = 'on'"))
        await s.commit()
        with pytest.raises(DBAPIError, match="append-only"):
            await s.execute(text("DELETE FROM audit_logs WHERE id = :id"), {"id": row.id})
        await s.rollback()
    assert await _exists(sf, AuditLog, row.id)

    await run_retention(sf)
    assert not await _exists(sf, AuditLog, row.id)


async def test_cleanup_jobs_prunes_finished_and_old_dead_jobs(sf):
    def job(status: str, age_days: float | None) -> Job:
        return Job(queue="maintenance", job_type="test.noop", payload={}, status=status,
                   dedupe_key=f"cleanup-{uuid.uuid4()}", finished_at=_ago(age_days) if age_days is not None else None)

    rows = await _add(sf, job("succeeded", 8), job("succeeded", 1), job("cancelled", 8), job("dead", 10),
                      job("dead", 31), job("pending", None))
    succeeded_old, succeeded_new, cancelled_old, dead_recent, dead_old, pending = rows
    counts = await cleanup_jobs(sf)
    assert counts["finished"] >= 2 and counts["dead"] >= 1
    for gone in (succeeded_old, cancelled_old, dead_old):
        assert not await _exists(sf, Job, gone.id)
    for kept in (succeeded_new, dead_recent, pending):
        assert await _exists(sf, Job, kept.id)
