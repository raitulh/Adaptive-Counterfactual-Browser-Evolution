"""Completion path for steps executed out-of-band by isolated workers (browser).

The isolated worker never mutates task state directly beyond this narrow API:
it records the outcome for the step it was dispatched for (checked against the
attempt/idempotency key it received), then wakes the execution engine, which
verifies the result like any other step.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import ErrorClass, TrustLevel
from app.common.events import EventType
from app.common.sanitize import bound_structure, clean_text
from app.common.time import utcnow
from app.tasks import repository as task_repo
from app.tasks.models import ExternalAction, TaskAttempt
from app.tasks.state import StepStatus, TaskStatus, append_event, transition_step
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue


async def record_external_outcome(session: AsyncSession, *, task_id: uuid.UUID, step_id: uuid.UUID,
                                  idempotency_key: str, output: dict[str, Any] | None, summary: str,
                                  error_class: ErrorClass | None = None, error_message: str | None = None,
                                  external_ref: str | None = None, ambiguous: bool = False,
                                  usage: dict[str, float] | None = None) -> bool:
    """Returns False when the step is no longer waiting for this dispatch (stale/duplicate)."""
    task = await task_repo.lock_task(session, task_id)
    step = await task_repo.lock_step(session, step_id)
    if step.status != StepStatus.WAITING_EXTERNAL.value or step.idempotency_key != idempotency_key:
        await session.commit()
        return False
    attempt = (await session.execute(select(TaskAttempt).where(TaskAttempt.step_id == step.id)
                                      .order_by(TaskAttempt.attempt_number.desc()).limit(1))).scalar_one_or_none()
    ledger = (await session.execute(select(ExternalAction).where(ExternalAction.idempotency_key == idempotency_key)
                                    .with_for_update())).scalar_one_or_none()
    now = utcnow()
    if error_class is None:
        step.output = bound_structure(output or {}, max_depth=10, max_items=200, max_string=40_000)
        step.output_trust = TrustLevel.UNTRUSTED_EXTERNAL_CONTENT.value
        step.output_summary = clean_text(summary, max_chars=500)
        step.external_ref = external_ref
        if attempt is not None:
            attempt.status, attempt.finished_at = "succeeded", now
        if ledger is not None:
            ledger.status, ledger.result, ledger.external_ref = "succeeded", step.output, external_ref
        transition_step(step, StepStatus.VERIFYING)
    else:
        if attempt is not None:
            attempt.status = "unknown" if ambiguous else "failed"
            attempt.finished_at = now
            attempt.error_class = error_class.value
            attempt.error_message = (error_message or "")[:1000]
        step.error_class = error_class.value
        step.error_code = "external_worker_error"
        step.error_message = clean_text(error_message or "The isolated worker reported an error.", max_chars=2000)
        if ambiguous:
            transition_step(step, StepStatus.REQUIRES_RECONCILIATION)
        else:
            if ledger is not None:
                ledger.status = "failed"
            retry = error_class.retryable and step.attempt_count < max(1, step.max_attempts)
            transition_step(step, StepStatus.RETRY_SCHEDULED if retry else StepStatus.FAILED)
            step.next_attempt_at = now if retry else None
            if error_class.retryable and not retry:
                step.error_message = (step.error_message or "") + " (retries exhausted)"
    task.browser_actions += int((usage or {}).get("browser_actions", 0))
    await append_event(session, task, EventType.TOOL_CALL_FINISHED, step_id=step.id,
                       payload={"step": step.step_key, "summary": step.output_summary,
                                "error_class": error_class.value if error_class else None})
    if task.status == TaskStatus.RUNNING.value or task.status == TaskStatus.QUEUED.value:
        await get_job_queue().enqueue(session, JobSpec(
            queue=Queues.EXECUTION, job_type="task.execute",
            payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)}, dedupe_key=f"task:{task.id}",
            tenant_id=task.tenant_id, priority=task.priority))
    await session.commit()
    return True
