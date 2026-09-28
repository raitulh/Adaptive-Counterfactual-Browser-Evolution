"""Maintenance jobs: periodic housekeeping enqueued by the scheduler, plus account purge.

Every handler is idempotent (jobs are at-least-once), runs on a *system* session (these jobs
legitimately span tenants) and does bounded work per run, committing in small batches so no
transaction stays open for long or across network I/O.

* ``maintenance.expire_approvals``     overdue approvals → expired (approvals service)
* ``maintenance.aggregate_usage``      usage roll-ups (usage service)
* ``maintenance.recover_stalled_tasks`` fail dead-lettered tasks truthfully, re-enqueue tasks whose
  worker/job vanished, settle automation runs
* ``maintenance.retention``            delete data past its retention period
* ``maintenance.cleanup_jobs``         prune finished jobs and stale worker heartbeats
* ``account.purge``                    right-to-delete workflow for one user
"""

from __future__ import annotations

import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.events import EventType
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.database import set_system_scope, set_tenant_scope
from app.tasks.models import Task
from app.tasks.state import TASK_TRANSITIONS, TaskStatus, append_event, transition_task
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import PermanentJobFailure
from app.workers.queues.models import Job, JobStatus

logger = logging.getLogger("agentos.maintenance")

SessionFactory = async_sessionmaker[AsyncSession]

EXECUTE_JOB = "task.execute"
PLAN_JOB = "task.plan"
DEAD_LETTER_CODE = "worker_dead_letter"
STALLED_EXECUTION_AFTER = timedelta(minutes=2)
STALLED_PLANNING_AFTER = timedelta(minutes=5)
DEAD_LETTER_LOOKBACK = timedelta(days=7)

# States in which a worker should be driving the task through ``task.execute`` / ``task.plan``.
EXECUTION_STATES: tuple[str, ...] = tuple(s.value for s in (
    TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.RECOVERING, TaskStatus.VERIFYING,
    TaskStatus.CANCEL_REQUESTED))
PLANNING_STATES: tuple[str, ...] = (TaskStatus.CREATED.value, TaskStatus.PLANNING.value)
_PLAN_PHASE_STATES = frozenset({*PLANNING_STATES, TaskStatus.PLANNED.value, TaskStatus.VALIDATING.value})
_LIVE_JOB = (JobStatus.PENDING, JobStatus.RUNNING)


@contextlib.asynccontextmanager
async def _system_session(sf: SessionFactory) -> AsyncIterator[AsyncSession]:
    async with sf() as session:
        set_system_scope(session)
        yield session


@contextlib.asynccontextmanager
async def _tenant_session(sf: SessionFactory, tenant_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    async with sf() as session:
        set_tenant_scope(session, tenant_id)
        yield session


def _uuid(payload: dict[str, Any], key: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(payload[key]))
    except (KeyError, ValueError) as exc:
        raise PermanentJobFailure(f"invalid payload field {key}") from exc


# ============================================================================ approvals / usage
@job("maintenance.expire_approvals")
async def expire_approvals_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    from app.approvals.service import expire_due

    async with _system_session(ctx.session_factory) as session:
        expired = await expire_due(session)
    if expired:
        logger.info("approvals expired", extra={"count": expired})


@job("maintenance.aggregate_usage")
async def aggregate_usage_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    from app.usage.service import aggregate_usage

    async with _system_session(ctx.session_factory) as session:
        await aggregate_usage(session)


# ============================================================================ stalled-task recovery
# Candidate selection. A task has a *live job* when a pending/running execute or plan job exists.
_DEAD_LETTERED_SQL = text("""
    SELECT DISTINCT ON (t.id) t.id AS task_id, t.tenant_id, t.status, j.id AS job_id, j.job_type
    FROM jobs j
    JOIN tasks t ON t.id::text = j.payload->>'task_id'
    WHERE j.status = 'dead' AND j.job_type IN ('task.execute', 'task.plan') AND j.finished_at > :since
      AND t.status = ANY(:active)
      AND NOT EXISTS (SELECT 1 FROM jobs lj WHERE lj.status IN ('pending', 'running')
                      AND lj.dedupe_key IN ('task:' || t.id::text, 'plan:' || t.id::text))
      AND NOT EXISTS (SELECT 1 FROM jobs later WHERE later.dedupe_key = j.dedupe_key
                      AND later.created_at > j.created_at)
    ORDER BY t.id, j.finished_at DESC
    LIMIT :limit
""")

_STALLED_EXECUTION_SQL = text("""
    SELECT t.id, t.tenant_id FROM tasks t
    WHERE t.status = ANY(:states) AND t.updated_at < :cutoff
      AND (t.lease_expires_at IS NULL OR t.lease_expires_at < :cutoff)
      AND NOT EXISTS (SELECT 1 FROM jobs lj WHERE lj.status IN ('pending', 'running')
                      AND lj.dedupe_key IN ('task:' || t.id::text, 'plan:' || t.id::text))
      AND NOT EXISTS (SELECT 1 FROM jobs d WHERE d.dedupe_key = 'task:' || t.id::text AND d.status = 'dead'
                      AND d.finished_at > t.updated_at)
    ORDER BY t.updated_at
    LIMIT :limit
""")

_STALLED_PLANNING_SQL = text("""
    SELECT t.id, t.tenant_id FROM tasks t
    WHERE t.status = ANY(:states) AND t.updated_at < :cutoff
      AND NOT EXISTS (SELECT 1 FROM jobs lj WHERE lj.status IN ('pending', 'running')
                      AND lj.dedupe_key IN ('task:' || t.id::text, 'plan:' || t.id::text))
      AND NOT EXISTS (SELECT 1 FROM jobs d WHERE d.dedupe_key = 'plan:' || t.id::text AND d.status = 'dead'
                      AND d.finished_at > t.updated_at)
    ORDER BY t.updated_at
    LIMIT :limit
""")


async def _live_job_for(session: AsyncSession, task_id: uuid.UUID) -> bool:
    count = (await session.execute(
        select(func.count()).select_from(Job).where(
            Job.dedupe_key.in_([f"task:{task_id}", f"plan:{task_id}"]), Job.status.in_(_LIVE_JOB))
    )).scalar_one()
    return bool(count)


async def fail_task_truthfully(session: AsyncSession, task: Task, *, code: str, message: str,
                               idempotency_suffix: str) -> bool:
    """Move a locked, non-terminal task to FAILED through legal transitions (via RUNNING when
    FAILED is not directly reachable), record why, audit it and notify the owner. No commit."""
    from app.execution.summary import build_summary
    from app.notifications.service import NotificationEvent, notify

    current = TaskStatus(task.status)
    if current == TaskStatus.FAILED:
        return False
    transitions = TASK_TRANSITIONS[current]
    if TaskStatus.FAILED not in transitions:
        if TaskStatus.RUNNING not in transitions:
            logger.warning("cannot fail task from state",
                           extra={"task_id": str(task.id), "state": current.value})
            return False
        await transition_task(session, task, TaskStatus.RUNNING, reason=code)
    task.failure_code = code[:80]
    task.failure_message = message[:2000]
    task.lease_owner = None
    task.lease_expires_at = None
    task.result_summary = await build_summary(session, task)
    await transition_task(session, task, TaskStatus.FAILED, reason=code)
    audit.record(session, category=AuditCategory.TASK, action="task.failed", status="failure",
                 tenant_id=task.tenant_id, user_id=task.user_id, actor_type="system", task_id=task.id,
                 result_summary=message[:500], metadata={"code": code, "previous_state": current.value})
    await notify(session, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.TASK_FAILED,
                 title="Task failed", body=message[:1000], data={"task_id": str(task.id), "code": code},
                 idempotency_key=f"failed:{task.id}:{idempotency_suffix}")
    return True


async def _fail_dead_lettered(sf: SessionFactory, row: Any) -> bool:
    from app.tasks.repository import lock_task

    allowed = _PLAN_PHASE_STATES if row.job_type == PLAN_JOB else frozenset(EXECUTION_STATES)
    if row.status not in allowed:
        return False
    async with _tenant_session(sf, row.tenant_id) as session:
        task = await lock_task(session, row.task_id)
        if task.status not in allowed or await _live_job_for(session, task.id):
            await session.rollback()
            return False
        phase = "planned" if row.job_type == PLAN_JOB else "executed"
        failed = await fail_task_truthfully(
            session, task, code=DEAD_LETTER_CODE, idempotency_suffix=f"dead:{row.job_id}",
            message=(f"The task could not be {phase}: the background worker processing it failed repeatedly "
                     "and gave up. Some steps may not have run; review the task before retrying it."))
        await session.commit()
        return failed


async def _reenqueue(sf: SessionFactory, task_id: uuid.UUID, tenant_id: uuid.UUID, *, planning: bool,
                     cutoff: datetime) -> bool:
    from app.tasks.repository import lock_task
    from app.tasks.service import _execute_job, _plan_job
    from app.workers.queues.postgres import get_job_queue

    states = PLANNING_STATES if planning else EXECUTION_STATES
    async with _tenant_session(sf, tenant_id) as session:
        task = await lock_task(session, task_id)
        lease = task.lease_expires_at
        stale = (task.status in states and task.updated_at < cutoff
                 and (planning or lease is None or lease < cutoff))
        if not stale or await _live_job_for(session, task.id):
            await session.rollback()
            return False
        spec = _plan_job(task, "recover") if planning else _execute_job(task)
        await get_job_queue().enqueue(session, spec)
        await append_event(session, task, EventType.RECOVERY_STARTED,
                           payload={"source": "maintenance", "reason": "worker_or_job_lost",
                                    "action": "replan" if planning else "resume_execution"})
        await session.commit()
        return True


@dataclass(slots=True)
class RecoveryReport:
    failed: int = 0
    execution_requeued: int = 0
    planning_requeued: int = 0
    runs_settled: int = 0
    errors: int = 0


async def recover_stalled_tasks(sf: SessionFactory, *, now: datetime | None = None,
                                limit: int = 200) -> RecoveryReport:
    """1. Tasks whose latest execute/plan job was dead-lettered → FAILED (``worker_dead_letter``).
    2. Execution-phase tasks with no pending/running job and no live lease for >2 min → re-enqueue
       ``task.execute``. 3. Planning-phase tasks with no plan job for >5 min → re-enqueue
       ``task.plan`` (mode ``recover``). 4. Settle automation runs from task outcomes."""
    now = now or utcnow()
    report = RecoveryReport()
    async with _system_session(sf) as session:
        dead = (await session.execute(_DEAD_LETTERED_SQL, {
            "since": now - DEAD_LETTER_LOOKBACK, "limit": limit,
            "active": list(_PLAN_PHASE_STATES | set(EXECUTION_STATES))})).all()
        stalled_exec = (await session.execute(_STALLED_EXECUTION_SQL, {
            "states": list(EXECUTION_STATES), "cutoff": now - STALLED_EXECUTION_AFTER, "limit": limit})).all()
        stalled_plan = (await session.execute(_STALLED_PLANNING_SQL, {
            "states": list(PLANNING_STATES), "cutoff": now - STALLED_PLANNING_AFTER, "limit": limit})).all()
    dead_ids = set()
    for row in dead:
        try:
            if await _fail_dead_lettered(sf, row):
                report.failed += 1
                dead_ids.add(row.task_id)
        except Exception:
            report.errors += 1
            logger.exception("failed to fail dead-lettered task", extra={"task_id": str(row.task_id)})
    for rows, planning, cutoff in ((stalled_exec, False, now - STALLED_EXECUTION_AFTER),
                                   (stalled_plan, True, now - STALLED_PLANNING_AFTER)):
        for task_id, tenant_id in rows:
            if task_id in dead_ids:
                continue
            try:
                if await _reenqueue(sf, task_id, tenant_id, planning=planning, cutoff=cutoff):
                    if planning:
                        report.planning_requeued += 1
                    else:
                        report.execution_requeued += 1
            except Exception:
                report.errors += 1
                logger.exception("failed to re-enqueue stalled task", extra={"task_id": str(task_id)})
    try:
        from app.automations.service import sync_run_outcomes

        async with _system_session(sf) as session:
            report.runs_settled = await sync_run_outcomes(session, limit=limit)
    except Exception:
        report.errors += 1
        logger.exception("automation run sync failed")
    return report


@job("maintenance.recover_stalled_tasks")
async def recover_stalled_tasks_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    report = await recover_stalled_tasks(ctx.session_factory)
    if report.failed or report.execution_requeued or report.planning_requeued or report.errors:
        logger.warning("stalled task recovery", extra={
            "failed": report.failed, "execution_requeued": report.execution_requeued,
            "planning_requeued": report.planning_requeued, "runs_settled": report.runs_settled,
            "errors": report.errors})


# ============================================================================ retention
@dataclass(slots=True)
class RetentionReport:
    deleted: dict[str, int] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


_TERMINAL_FOR_RETENTION = [TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value, TaskStatus.FAILED.value,
                           TaskStatus.EXPIRED.value]

# name → (DELETE statement bounded by :batch, uses the audit escape hatch)
_RETENTION_SQL: dict[str, str] = {
    # Events of finished tasks (completed/cancelled, or failed/expired and untouched since).
    "task_events": """
        DELETE FROM task_events WHERE id IN (
            SELECT e.id FROM task_events e JOIN tasks t ON t.id = e.task_id
            WHERE e.created_at < :cutoff AND t.status = ANY(:terminal)
              AND t.updated_at < :cutoff AND coalesce(t.completed_at, t.updated_at) < :cutoff
            LIMIT :batch)""",
    "execution_logs": """
        DELETE FROM execution_logs WHERE id IN (
            SELECT id FROM execution_logs WHERE created_at < :cutoff LIMIT :batch)""",
    "notifications": """
        DELETE FROM notifications WHERE id IN (
            SELECT id FROM notifications WHERE created_at < :cutoff LIMIT :batch)""",
    "outbox_events": """
        DELETE FROM outbox_events WHERE id IN (
            SELECT id FROM outbox_events WHERE published_at IS NOT NULL AND published_at < :cutoff
            LIMIT :batch)""",
    "api_idempotency_keys": """
        DELETE FROM api_idempotency_keys WHERE id IN (
            SELECT id FROM api_idempotency_keys WHERE expires_at < :cutoff LIMIT :batch)""",
    "webhook_deliveries": """
        DELETE FROM webhook_deliveries WHERE id IN (
            SELECT id FROM webhook_deliveries WHERE received_at < :cutoff LIMIT :batch)""",
    "usage_events": """
        DELETE FROM usage_events WHERE id IN (
            SELECT id FROM usage_events WHERE occurred_at < :cutoff LIMIT :batch)""",
    "automation_runs": """
        DELETE FROM automation_runs WHERE id IN (
            SELECT id FROM automation_runs WHERE status <> 'created' AND created_at < :cutoff
            LIMIT :batch)""",
    "audit_logs": """
        DELETE FROM audit_logs WHERE id IN (
            SELECT id FROM audit_logs WHERE created_at < :cutoff LIMIT :batch)""",
}


def _retention_cutoffs(now: datetime) -> dict[str, datetime]:
    s = get_settings()
    return {
        "task_events": now - timedelta(days=s.retention_task_events_days),
        "execution_logs": now - timedelta(days=s.retention_execution_logs_days),
        "notifications": now - timedelta(days=s.retention_notifications_days),
        "outbox_events": now - timedelta(days=1),
        "api_idempotency_keys": now,
        "webhook_deliveries": now - timedelta(days=30),
        "usage_events": now - timedelta(days=s.retention_usage_events_days),
        "automation_runs": now - timedelta(days=s.retention_task_events_days),
        "audit_logs": now - timedelta(days=s.retention_audit_days),
    }


async def _delete_in_batches(sf: SessionFactory, name: str, cutoff: datetime, *, batch_size: int,
                             max_batches: int) -> int:
    statement = text(_RETENTION_SQL[name])
    params: dict[str, Any] = {"cutoff": cutoff, "batch": batch_size}
    if name == "task_events":
        params["terminal"] = _TERMINAL_FOR_RETENTION
    total = 0
    for _ in range(max_batches):
        async with _system_session(sf) as session:
            if name == "audit_logs":
                # The append-only trigger lets DELETEs through only in a transaction that sets
                # this flag; SET LOCAL scopes it to this transaction alone.
                await session.execute(text("SET LOCAL agentos.audit_retention = 'on'"))
            deleted = int((await session.execute(statement, params)).rowcount or 0)  # type: ignore[attr-defined]
            if name == "audit_logs" and deleted:
                audit.record(session, category=AuditCategory.ADMIN, action="audit.retention_purged",
                             actor_type="system", metadata={"count": deleted, "cutoff": cutoff.isoformat()})
            await session.commit()
        total += deleted
        if deleted < batch_size:
            break
    return total


async def run_retention(sf: SessionFactory, *, now: datetime | None = None, batch_size: int = 5000,
                        max_batches: int = 20) -> RetentionReport:
    """Delete rows past their retention period in bounded batches; each category is isolated
    so one failure does not block the others."""
    now = now or utcnow()
    report = RetentionReport()
    for name, cutoff in _retention_cutoffs(now).items():
        try:
            report.deleted[name] = await _delete_in_batches(sf, name, cutoff, batch_size=batch_size,
                                                            max_batches=max_batches)
        except Exception:
            report.errors.append(name)
            logger.exception("retention step failed", extra={"step": name})
    try:
        from app.files.service import purge_expired_files

        async with _system_session(sf) as session:
            report.deleted["temp_files"] = await purge_expired_files(session, now)
            await session.commit()
    except Exception:
        report.errors.append("temp_files")
        logger.exception("retention step failed", extra={"step": "temp_files"})
    try:
        from app.browser.service import (
            purge_browser_artifacts,  # type: ignore[import-not-found,unused-ignore]
        )

        older_than = now - timedelta(days=get_settings().retention_browser_artifacts_days)
        async with _system_session(sf) as session:
            report.deleted["browser_artifacts"] = int(await purge_browser_artifacts(session, older_than) or 0)
            await session.commit()
    except Exception:
        report.errors.append("browser_artifacts")
        logger.exception("retention step failed", extra={"step": "browser_artifacts"})
    return report


@job("maintenance.retention")
async def retention_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    report = await run_retention(ctx.session_factory)
    logger.info("retention completed", extra={"deleted": report.deleted, "errors": report.errors})


# ============================================================================ job table cleanup
SUCCEEDED_JOB_RETENTION = timedelta(days=7)
DEAD_JOB_RETENTION = timedelta(days=30)
HEARTBEAT_RETENTION = timedelta(days=7)

_CLEANUP_JOBS_SQL = text("""
    DELETE FROM jobs WHERE id IN (
        SELECT id FROM jobs WHERE status = ANY(:statuses) AND coalesce(finished_at, updated_at) < :cutoff
        LIMIT :batch)
""")


async def cleanup_jobs(sf: SessionFactory, *, now: datetime | None = None, batch_size: int = 5000,
                       max_batches: int = 20) -> dict[str, int]:
    """Succeeded/cancelled jobs are kept 7 days, dead-lettered jobs 30 days (for diagnosis)."""
    now = now or utcnow()
    counts: dict[str, int] = {}
    for label, statuses, cutoff in (
            ("finished", [JobStatus.SUCCEEDED, JobStatus.CANCELLED], now - SUCCEEDED_JOB_RETENTION),
            ("dead", [JobStatus.DEAD], now - DEAD_JOB_RETENTION)):
        total = 0
        for _ in range(max_batches):
            async with _system_session(sf) as session:
                result = await session.execute(_CLEANUP_JOBS_SQL, {"statuses": statuses, "cutoff": cutoff,
                                                                   "batch": batch_size})
                deleted = int(result.rowcount or 0)  # type: ignore[attr-defined]
                await session.commit()
            total += deleted
            if deleted < batch_size:
                break
        counts[label] = total
    async with _system_session(sf) as session:
        result = await session.execute(text("DELETE FROM worker_heartbeats WHERE last_seen_at < :cutoff"),
                                       {"cutoff": now - HEARTBEAT_RETENTION})
        counts["worker_heartbeats"] = int(result.rowcount or 0)  # type: ignore[attr-defined]
        await session.commit()
    return counts


@job("maintenance.cleanup_jobs")
async def cleanup_jobs_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    counts = await cleanup_jobs(ctx.session_factory)
    logger.info("job cleanup completed", extra=counts)


# ============================================================================ account purge
RevokeFn = Callable[[str], Awaitable[bool]]
_PURGEABLE_STATUSES = ("deletion_pending", "deleted")


async def _default_revoke(token: str) -> bool:
    from app.integrations.google.oauth import GoogleOAuthClient

    return await GoogleOAuthClient().revoke(token)


async def _user_tenants(session: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    from app.automations.models import Automation
    from app.integrations.models import OAuthConnection
    from app.memory.models import MemoryItem
    from app.organizations.models import OrganizationMember

    tenant_ids: set[uuid.UUID] = set()
    for model in (OrganizationMember, OAuthConnection, Task, Automation, MemoryItem):
        rows = (await session.execute(
            select(model.tenant_id).where(model.user_id == user_id).distinct())).scalars().all()
        tenant_ids.update(rows)
    with contextlib.suppress(ImportError):
        from app.files.models import File

        tenant_ids.update((await session.execute(
            select(File.tenant_id).where(File.user_id == user_id).distinct())).scalars().all())
    return sorted(tenant_ids)


async def _purge_integrations(sf: SessionFactory, tenant_id: uuid.UUID, user_id: uuid.UUID,
                              revoke: RevokeFn) -> int:
    """Revoke Google grants at the provider (best effort, outside any transaction), then delete
    the connections and scopes. Tokens are never logged."""
    from app.core.crypto import DecryptionError, get_key_manager
    from app.integrations.models import OAuthConnection, OAuthScope

    tokens: list[tuple[uuid.UUID, str]] = []
    async with _tenant_session(sf, tenant_id) as session:
        connections = (await session.execute(select(OAuthConnection).where(
            OAuthConnection.tenant_id == tenant_id, OAuthConnection.user_id == user_id))).scalars().all()
        for conn in connections:
            ciphertext = conn.refresh_token_enc or conn.access_token_enc
            if conn.provider != "google" or not ciphertext:
                continue
            try:
                tokens.append((conn.id, get_key_manager().decrypt(ciphertext)))
            except DecryptionError:
                logger.warning("cannot decrypt credential for revocation",
                               extra={"connection_id": str(conn.id)})
        connection_ids = [c.id for c in connections]
        await session.rollback()
    revoked = 0
    for connection_id, token in tokens:
        try:
            if await revoke(token):
                revoked += 1
            else:
                logger.warning("provider revocation not confirmed",
                               extra={"connection_id": str(connection_id)})
        except Exception:
            logger.warning("provider revocation failed", extra={"connection_id": str(connection_id)})
    async with _tenant_session(sf, tenant_id) as session:
        if connection_ids:
            await session.execute(delete(OAuthScope).where(OAuthScope.connection_id.in_(connection_ids))
                                  .execution_options(synchronize_session=False))
        await session.execute(delete(OAuthConnection).where(
            OAuthConnection.tenant_id == tenant_id, OAuthConnection.user_id == user_id)
            .execution_options(synchronize_session=False))
        if connection_ids:
            audit.record(session, category=AuditCategory.INTEGRATION, action="integration.purged",
                         tenant_id=tenant_id, user_id=user_id, actor_type="system",
                         metadata={"connections": len(connection_ids), "revoked": revoked})
        await session.commit()
    return len(connection_ids)


async def _purge_tenant_data(sf: SessionFactory, tenant_id: uuid.UUID, user_id: uuid.UUID) -> dict[str, int]:
    from app.automations.service import purge_user_automations
    from app.common.models import ApiIdempotencyKey
    from app.files.service import purge_user_files
    from app.memory.service import purge_user_memories
    from app.notifications.models import Notification
    from app.tools.models import ToolCredential

    counts: dict[str, int] = {}
    async with _tenant_session(sf, tenant_id) as session:
        counts["memories"] = await purge_user_memories(session, tenant_id=tenant_id, user_id=user_id)
        counts["files"] = await purge_user_files(session, tenant_id, user_id)
        counts["automations"] = await purge_user_automations(session, tenant_id=tenant_id, user_id=user_id)
        await session.execute(delete(ToolCredential).where(
            ToolCredential.tenant_id == tenant_id, ToolCredential.user_id == user_id)
            .execution_options(synchronize_session=False))
        await session.execute(delete(Notification).where(
            Notification.tenant_id == tenant_id, Notification.user_id == user_id)
            .execution_options(synchronize_session=False))
        await session.execute(delete(ApiIdempotencyKey).where(
            ApiIdempotencyKey.tenant_id == tenant_id, ApiIdempotencyKey.user_id == user_id)
            .execution_options(synchronize_session=False))
        await session.commit()
    counts["tasks"] = await _purge_tasks(sf, tenant_id, user_id)
    return counts


async def _purge_tasks(sf: SessionFactory, tenant_id: uuid.UUID, user_id: uuid.UUID, *,
                       batch_size: int = 500) -> int:
    """Hard-delete the user's tasks (steps, events, attempts, approvals… cascade) in batches,
    cancelling their pending jobs first."""
    total = 0
    while True:
        async with _tenant_session(sf, tenant_id) as session:
            ids = list((await session.execute(select(Task.id).where(
                Task.tenant_id == tenant_id, Task.user_id == user_id).limit(batch_size))).scalars().all())
            if not ids:
                return total
            await session.execute(
                update(Job).where(Job.status == JobStatus.PENDING, Job.tenant_id == tenant_id,
                                  Job.payload["task_id"].astext.in_([str(i) for i in ids]))
                .values(status=JobStatus.CANCELLED, finished_at=utcnow(), last_error="account deleted")
                .execution_options(synchronize_session=False))
            await session.execute(delete(Task).where(Task.id.in_(ids))
                                  .execution_options(synchronize_session=False))
            await session.commit()
        total += len(ids)


async def _remove_memberships(sf: SessionFactory, tenant_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    """Remove the user's membership; delete the organization itself if it is the user's personal
    organization and nobody else belongs to it (all tenant data cascades; audit is retained)."""
    from app.organizations.models import Organization, OrganizationMember

    async with _tenant_session(sf, tenant_id) as session:
        org = (await session.execute(select(Organization).where(Organization.id == tenant_id)
                                     .with_for_update())).scalar_one_or_none()
        others = int((await session.execute(select(func.count()).select_from(OrganizationMember).where(
            OrganizationMember.tenant_id == tenant_id, OrganizationMember.user_id != user_id))).scalar_one())
        await session.execute(delete(OrganizationMember).where(
            OrganizationMember.tenant_id == tenant_id, OrganizationMember.user_id == user_id)
            .execution_options(synchronize_session=False))
        org_deleted = org is not None and org.is_personal and others == 0
        if org_deleted:
            await session.execute(delete(Organization).where(Organization.id == tenant_id)
                                  .execution_options(synchronize_session=False))
        audit.record(session, category=AuditCategory.DATA, action="user.membership_purged",
                     tenant_id=tenant_id, user_id=user_id, actor_type="system",
                     metadata={"organization_deleted": org_deleted})
        await session.commit()
    return org_deleted


async def _anonymize_user(sf: SessionFactory, user_id: uuid.UUID) -> None:
    from app.auth.models import AuthSession, MfaFactor
    from app.users.models import User, UserIdentity, UserStatus

    async with _system_session(sf) as session:
        user = (await session.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one()
        await session.execute(delete(UserIdentity).where(UserIdentity.user_id == user_id))
        await session.execute(delete(MfaFactor).where(MfaFactor.user_id == user_id))
        await session.execute(delete(AuthSession).where(AuthSession.user_id == user_id))
        user.email = f"deleted-{user.id}@deleted.invalid"
        user.email_verified = False
        user.display_name = None
        user.password_hash = None
        user.mfa_enabled = False
        user.is_platform_admin = False
        user.default_tenant_id = None
        user.status = UserStatus.DELETED
        user.deleted_at = user.deleted_at or utcnow()
        audit.record(session, category=AuditCategory.SECURITY, action="user.purged", user_id=user_id,
                     actor_type="system")
        await session.commit()


async def purge_account(sf: SessionFactory, user_id: uuid.UUID, *, revoke: RevokeFn | None = None
                        ) -> dict[str, Any]:
    """Right-to-delete. Per tenant: revoke + delete integrations, purge memories, files,
    automations, notifications and tasks, drop the membership (and the personal organization
    when the user is its only member); finally anonymize the user row. Audit logs are retained.
    Every step is idempotent, so a crashed/retried job resumes safely."""
    from app.users.models import User

    async with _system_session(sf) as session:
        user = await session.get(User, user_id)
        if user is None:
            return {"status": "missing"}
        if user.status not in _PURGEABLE_STATUSES:
            logger.warning("refusing to purge an account not pending deletion",
                           extra={"user_id": str(user_id)})
            return {"status": "not_pending"}
        tenants = await _user_tenants(session, user_id)
    summary: dict[str, Any] = {"status": "purged", "tenants": len(tenants), "organizations_deleted": 0,
                               "integrations": 0}
    for tenant_id in tenants:
        summary["integrations"] += await _purge_integrations(sf, tenant_id, user_id,
                                                             revoke or _default_revoke)
        for key, value in (await _purge_tenant_data(sf, tenant_id, user_id)).items():
            summary[key] = summary.get(key, 0) + value
        if await _remove_memberships(sf, tenant_id, user_id):
            summary["organizations_deleted"] += 1
    await _anonymize_user(sf, user_id)
    return summary


@job("account.purge")
async def account_purge_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    user_id = _uuid(payload, "user_id")
    summary = await purge_account(ctx.session_factory, user_id)
    logger.info("account purge finished", extra={"user_id": str(user_id), **{
        k: v for k, v in summary.items() if isinstance(v, int | str)}})
