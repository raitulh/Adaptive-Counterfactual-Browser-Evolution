"""browser service: BrowserTask lifecycle, reconciliation lookups and artifact retention.

All functions take the caller's session and never commit unless documented (the
retention purge commits between batches so it never holds a transaction open across
object-storage I/O).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from urllib.parse import urlsplit

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.browser.actions import redact_actions
from app.browser.models import BrowserSession, BrowserSessionStatus, BrowserTask, BrowserTaskStatus
from app.browser.schemas import BrowserRunResult
from app.common.enums import ErrorClass
from app.common.ids import new_id
from app.common.sanitize import bound_structure, clean_text
from app.common.time import utcnow
from app.core.exceptions import Conflict
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

logger = logging.getLogger(__name__)

JOB_TYPE = "browser.run"
JOB_MAX_ATTEMPTS = 5
RESULT_BOUNDS: dict[str, int] = {"max_depth": 8, "max_items": 200, "max_string": 20_000}


# ---------------------------------------------------------------------------- lookups
async def get_browser_task(session: AsyncSession, browser_task_id: uuid.UUID, *, lock: bool = False
                           ) -> BrowserTask | None:
    stmt = select(BrowserTask).where(BrowserTask.id == browser_task_id).execution_options(populate_existing=True)
    if lock:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def get_by_idempotency_key(session: AsyncSession, idempotency_key: str, *, lock: bool = False
                                 ) -> BrowserTask | None:
    stmt = (select(BrowserTask).where(BrowserTask.idempotency_key == idempotency_key)
            .execution_options(populate_existing=True))
    if lock:
        stmt = stmt.with_for_update()
    return (await session.execute(stmt)).scalar_one_or_none()


async def list_step_tasks(session: AsyncSession, step_id: uuid.UUID) -> list[BrowserTask]:
    return list((await session.execute(
        select(BrowserTask).where(BrowserTask.step_id == step_id).order_by(BrowserTask.created_at)
    )).scalars().all())


# ---------------------------------------------------------------------------- dispatch
async def dispatch_browser_task(
    session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID | None, task_id: uuid.UUID,
    step_id: uuid.UUID, idempotency_key: str, tool_name: str, actions: list[dict[str, Any]],
    options: dict[str, Any], timeout_seconds: int,
) -> tuple[BrowserTask, bool]:
    """Create — or re-arm after a failure/cancellation — the BrowserTask for this idempotency
    key and enqueue its ``browser.run`` job, in the caller's transaction. Returns
    ``(task, created)``. A succeeded task is not re-run: its job simply reports the stored
    result again."""
    inserted = (await session.execute(
        insert(BrowserTask).values(
            id=new_id(), tenant_id=tenant_id, user_id=user_id, task_id=task_id, step_id=step_id,
            tool_name=tool_name, idempotency_key=idempotency_key, actions=actions, options=options,
            status=BrowserTaskStatus.QUEUED, timeout_seconds=timeout_seconds, artifact_keys=[], attempts=0,
        ).on_conflict_do_nothing(index_elements=["idempotency_key"]).returning(BrowserTask.id),
    )).scalar_one_or_none()
    task = await get_by_idempotency_key(session, idempotency_key, lock=True)
    if task is None or task.task_id != task_id or task.step_id != step_id:
        raise Conflict("The idempotency key is already used by a different browser task.")
    if task.status in (BrowserTaskStatus.FAILED, BrowserTaskStatus.CANCELLED):
        task.status = BrowserTaskStatus.QUEUED
        task.actions = actions
        task.options = options
        task.tool_name = tool_name
        task.timeout_seconds = timeout_seconds
        task.result = None
        task.error_class = None
        task.error_message = None
        task.started_at = None
        task.completed_at = None
    await enqueue_run(session, task)
    return task, inserted is not None


async def enqueue_run(session: AsyncSession, task: BrowserTask, *, delay_seconds: float = 0.0) -> None:
    await get_job_queue().enqueue(session, JobSpec(
        queue=Queues.BROWSER, job_type=JOB_TYPE,
        payload={"browser_task_id": str(task.id), "tenant_id": str(task.tenant_id)},
        dedupe_key=f"browser:{task.id}", tenant_id=task.tenant_id, max_attempts=JOB_MAX_ATTEMPTS,
        delay_seconds=delay_seconds,
    ))


async def cancel_queued(session: AsyncSession, task: BrowserTask, *, reason: str) -> bool:
    """Atomically cancel a task that has not started; False if a worker already took it."""
    result = await session.execute(
        update(BrowserTask).where(BrowserTask.id == task.id, BrowserTask.status == BrowserTaskStatus.QUEUED)
        .values(status=BrowserTaskStatus.CANCELLED, completed_at=utcnow(), error_message=reason[:500])
        .execution_options(synchronize_session=False))
    return bool(result.rowcount)  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------- worker lifecycle
def mark_running(session: AsyncSession, task: BrowserTask, *, worker_id: str, now: datetime | None = None
                 ) -> BrowserSession:
    now = now or utcnow()
    task.status = BrowserTaskStatus.RUNNING
    task.started_at = now
    task.completed_at = None
    task.attempts += 1
    row = BrowserSession(tenant_id=task.tenant_id, task_id=task.task_id, step_id=task.step_id,
                         browser_task_id=task.id, worker_id=worker_id[:200], status=BrowserSessionStatus.STARTING,
                         started_at=now)
    session.add(row)
    return row


async def close_open_sessions(session: AsyncSession, browser_task_id: uuid.UUID, *, status: str, error: str
                              ) -> None:
    await session.execute(
        update(BrowserSession).where(BrowserSession.browser_task_id == browser_task_id,
                                     BrowserSession.status.in_(BrowserSessionStatus.OPEN))
        .values(status=status, ended_at=utcnow(), error=error[:1000])
        .execution_options(synchronize_session=False))


async def mark_session_active(session: AsyncSession, session_id: uuid.UUID) -> None:
    await session.execute(
        update(BrowserSession).where(BrowserSession.id == session_id,
                                     BrowserSession.status == BrowserSessionStatus.STARTING)
        .values(status=BrowserSessionStatus.ACTIVE).execution_options(synchronize_session=False))


def fail_task(task: BrowserTask, error_class: ErrorClass, message: str, *, result: dict[str, Any] | None = None
              ) -> None:
    task.status = BrowserTaskStatus.FAILED
    task.error_class = error_class.value
    task.error_message = clean_text(message, max_chars=1000)
    task.result = result
    task.completed_at = utcnow()
    task.actions = redact_actions(list(task.actions or []))


def record_run(task: BrowserTask, row: BrowserSession | None, result: BrowserRunResult, *,
               error_class: ErrorClass | None, error_message: str | None) -> None:
    """Store the outcome of one executor run on the task and its session row."""
    now = utcnow()
    status = BrowserTaskStatus.SUCCEEDED if error_class is None else BrowserTaskStatus.FAILED
    task.result = bound_structure(result.observations(task.id, status=status), **RESULT_BOUNDS)
    task.artifact_keys = sorted({*(task.artifact_keys or []), *result.screenshots})
    if error_class is None:
        task.status = BrowserTaskStatus.SUCCEEDED
        task.error_class = None
        task.error_message = None
        task.completed_at = now
        task.actions = redact_actions(list(task.actions or []))
    else:
        fail_task(task, error_class, error_message or "The browser task failed.", result=task.result)
    if row is not None:
        row.status = BrowserSessionStatus.CRASHED if result.crashed else BrowserSessionStatus.CLOSED
        row.ended_at = now
        row.pages_visited = result.pages_visited
        row.actions_count = result.actions_executed
        row.error = clean_text(result.error_message, max_chars=1000) if result.error_message else None


def summarize(task: BrowserTask) -> str:
    result = task.result or {}
    actions = int(result.get("actions_executed") or 0)
    if task.status == BrowserTaskStatus.SUCCEEDED:
        host = _host(result.get("final_url"))
        where = f"; final page on {host}" if host else ""
        return f"Browser completed {actions} action(s){where}"
    return clean_text(f"Browser task failed after {actions} action(s): {task.error_message or 'unknown error'}",
                      max_chars=500)


def _host(url: Any) -> str | None:
    if not isinstance(url, str):
        return None
    try:
        return urlsplit(url).hostname
    except ValueError:
        return None


# ---------------------------------------------------------------------------- reconciliation
@dataclass(slots=True)
class ReconcileView:
    status: str  # found | not_found | unknown
    task: BrowserTask | None = None
    evidence: dict[str, Any] = field(default_factory=dict)


async def reconcile_lookup(session: AsyncSession, idempotency_key: str) -> ReconcileView:
    """Did the dispatch with this idempotency key take effect?

    succeeded → found; never created / never started (cancelled atomically so it cannot
    start later) / failed before any interactive action → not_found; interrupted while
    running or failed after an interactive action → unknown."""
    task = await get_by_idempotency_key(session, idempotency_key, lock=True)
    if task is None:
        return ReconcileView("not_found", evidence={"reason": "no browser task was dispatched"})
    evidence: dict[str, Any] = {"browser_task_id": str(task.id), "status": task.status, "attempts": task.attempts}
    if task.status == BrowserTaskStatus.QUEUED:
        if await cancel_queued(session, task, reason="Cancelled during reconciliation before it started."):
            return ReconcileView("not_found", task, {**evidence, "reason": "never started"})
        task = await get_by_idempotency_key(session, idempotency_key, lock=True)
        if task is None:
            return ReconcileView("not_found", evidence={"reason": "no browser task was dispatched"})
        evidence["status"] = task.status
    if task.status == BrowserTaskStatus.SUCCEEDED:
        return ReconcileView("found", task, {**evidence, "reason": "completed"})
    if task.status == BrowserTaskStatus.CANCELLED:
        return ReconcileView("not_found", task, {**evidence, "reason": "cancelled before running"})
    if task.status == BrowserTaskStatus.FAILED and task.error_class != ErrorClass.UNKNOWN_OUTCOME.value:
        return ReconcileView("not_found", task, {**evidence, "reason": "failed before taking effect",
                                                 "error_class": task.error_class})
    reason = "interrupted while running" if task.status == BrowserTaskStatus.RUNNING else "outcome unknown"
    return ReconcileView("unknown", task, {**evidence, "reason": reason})


# ---------------------------------------------------------------------------- retention
async def purge_browser_artifacts(session: AsyncSession, older_than: datetime, *, storage: Any = None,
                                  batch_size: int = 500) -> int:
    """Delete finished browser tasks created before ``older_than`` together with their
    stored screenshots and session rows. Commits after each batch (object-storage I/O
    happens outside any transaction). Returns the number of tasks purged. Use a system
    session for a cross-tenant sweep or a tenant-scoped one for a single tenant."""
    if storage is None:
        from app.files.storage import build_storage

        storage = build_storage()
    purged = 0
    while True:
        rows = (await session.execute(
            select(BrowserTask.id, BrowserTask.artifact_keys)
            .where(BrowserTask.created_at < older_than, BrowserTask.status.in_(BrowserTaskStatus.TERMINAL))
            .order_by(BrowserTask.created_at).limit(batch_size)
        )).all()
        await session.commit()
        if not rows:
            break
        deletable: list[uuid.UUID] = []
        for task_id, keys in rows:
            if await _delete_objects(storage, keys or []):
                deletable.append(task_id)
        if deletable:
            await session.execute(delete(BrowserTask).where(BrowserTask.id.in_(deletable))
                                  .execution_options(synchronize_session=False))
            await session.commit()
            purged += len(deletable)
        if len(rows) < batch_size or not deletable:
            break
    if purged:
        logger.info("purged browser artifacts", extra={"count": purged})
    return purged


async def _delete_objects(storage: Any, keys: list[str]) -> bool:
    from app.files.storage import ObjectNotFound

    ok = True
    for key in keys:
        try:
            await storage.delete(key)
        except ObjectNotFound:
            continue
        except Exception:
            logger.warning("failed to delete browser artifact", extra={"key": key})
            ok = False
    return ok
