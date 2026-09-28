"""Deterministic task/step state machines.

Only transitions listed here are legal; everything else raises
``InvalidStateTransition``. Every task transition appends an immutable
``task_events`` row (and an outbox record) in the same transaction as the
state change, with a per-task, gap-free, commit-ordered sequence number.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import StrEnum
from app.common.events import EventType, task_channel, user_channel
from app.common.outbox import add_outbox_event
from app.common.time import utcnow
from app.core import metrics
from app.core.exceptions import InvalidStateTransition
from app.tasks.models import Task, TaskEvent, TaskStep


class TaskStatus(StrEnum):
    CREATED = "created"
    PLANNING = "planning"
    PLANNED = "planned"
    VALIDATING = "validating"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_INPUT = "waiting_input"
    QUEUED = "queued"
    RUNNING = "running"
    VERIFYING = "verifying"
    RECOVERING = "recovering"
    REQUIRES_RECONCILIATION = "requires_reconciliation"
    PAUSED = "paused"
    CANCEL_REQUESTED = "cancel_requested"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"
    EXPIRED = "expired"


S = TaskStatus

TERMINAL: frozenset[TaskStatus] = frozenset({S.COMPLETED, S.CANCELLED})
# States in which no worker is (or should be) actively driving the task.
RESTING: frozenset[TaskStatus] = frozenset({
    S.WAITING_APPROVAL, S.WAITING_INPUT, S.PAUSED, S.BLOCKED, S.FAILED, S.EXPIRED, S.REQUIRES_RECONCILIATION,
    S.COMPLETED, S.CANCELLED,
})
ACTIVE: frozenset[TaskStatus] = frozenset({
    S.CREATED, S.PLANNING, S.PLANNED, S.VALIDATING, S.QUEUED, S.RUNNING, S.VERIFYING, S.RECOVERING,
    S.CANCEL_REQUESTED,
})

TASK_TRANSITIONS: dict[TaskStatus, frozenset[TaskStatus]] = {
    S.CREATED: frozenset({S.PLANNING, S.CANCELLED, S.FAILED, S.CANCEL_REQUESTED}),
    S.PLANNING: frozenset({S.PLANNED, S.WAITING_INPUT, S.FAILED, S.BLOCKED, S.CANCEL_REQUESTED, S.CANCELLED}),
    S.PLANNED: frozenset({S.VALIDATING, S.CANCELLED, S.CANCEL_REQUESTED, S.FAILED}),
    S.VALIDATING: frozenset({S.QUEUED, S.PLANNING, S.BLOCKED, S.FAILED, S.CANCELLED, S.CANCEL_REQUESTED,
                             S.WAITING_INPUT}),
    S.QUEUED: frozenset({S.RUNNING, S.CANCELLED, S.PAUSED, S.FAILED, S.EXPIRED, S.CANCEL_REQUESTED}),
    S.RUNNING: frozenset({S.VERIFYING, S.WAITING_APPROVAL, S.WAITING_INPUT, S.RECOVERING, S.REQUIRES_RECONCILIATION,
                          S.QUEUED, S.FAILED, S.BLOCKED, S.CANCEL_REQUESTED, S.PAUSED, S.PLANNING, S.CANCELLED}),
    S.VERIFYING: frozenset({S.COMPLETED, S.FAILED, S.RECOVERING, S.RUNNING, S.REQUIRES_RECONCILIATION,
                            S.CANCEL_REQUESTED, S.QUEUED}),
    S.RECOVERING: frozenset({S.QUEUED, S.RUNNING, S.PLANNING, S.WAITING_INPUT, S.WAITING_APPROVAL, S.BLOCKED,
                             S.FAILED, S.REQUIRES_RECONCILIATION, S.CANCEL_REQUESTED}),
    S.WAITING_APPROVAL: frozenset({S.QUEUED, S.FAILED, S.CANCELLED, S.EXPIRED, S.PAUSED, S.RUNNING}),
    S.WAITING_INPUT: frozenset({S.PLANNING, S.QUEUED, S.CANCELLED, S.EXPIRED, S.FAILED}),
    S.REQUIRES_RECONCILIATION: frozenset({S.QUEUED, S.RUNNING, S.FAILED, S.CANCELLED, S.WAITING_INPUT}),
    S.PAUSED: frozenset({S.QUEUED, S.CANCELLED}),
    S.CANCEL_REQUESTED: frozenset({S.CANCELLED, S.FAILED, S.COMPLETED, S.REQUIRES_RECONCILIATION}),
    S.BLOCKED: frozenset({S.QUEUED, S.PLANNING, S.CANCELLED, S.FAILED}),
    S.FAILED: frozenset({S.QUEUED, S.PLANNING, S.CANCELLED}),
    S.EXPIRED: frozenset({S.QUEUED, S.CANCELLED}),
    S.COMPLETED: frozenset(),
    S.CANCELLED: frozenset(),
}


class StepStatus(StrEnum):
    PENDING = "pending"
    WAITING_APPROVAL = "waiting_approval"
    WAITING_INPUT = "waiting_input"
    RUNNING = "running"
    WAITING_EXTERNAL = "waiting_external"
    VERIFYING = "verifying"
    RETRY_SCHEDULED = "retry_scheduled"
    REQUIRES_RECONCILIATION = "requires_reconciliation"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"


St = StepStatus
STEP_TERMINAL = frozenset({St.COMPLETED, St.FAILED, St.SKIPPED, St.CANCELLED})
# Terminal for scheduling purposes; FAILED and SKIPPED can be re-opened only by an explicit user resume.

STEP_TRANSITIONS: dict[StepStatus, frozenset[StepStatus]] = {
    St.PENDING: frozenset({St.RUNNING, St.WAITING_APPROVAL, St.WAITING_INPUT, St.SKIPPED, St.CANCELLED, St.BLOCKED,
                           St.FAILED}),
    St.WAITING_APPROVAL: frozenset({St.RUNNING, St.FAILED, St.CANCELLED, St.PENDING, St.SKIPPED}),
    St.WAITING_INPUT: frozenset({St.PENDING, St.CANCELLED, St.FAILED, St.SKIPPED}),
    St.RUNNING: frozenset({St.VERIFYING, St.WAITING_EXTERNAL, St.RETRY_SCHEDULED, St.REQUIRES_RECONCILIATION,
                           St.FAILED, St.BLOCKED, St.WAITING_INPUT, St.CANCELLED, St.PENDING, St.COMPLETED}),
    St.WAITING_EXTERNAL: frozenset({St.VERIFYING, St.FAILED, St.RETRY_SCHEDULED, St.REQUIRES_RECONCILIATION,
                                    St.CANCELLED, St.RUNNING}),
    St.VERIFYING: frozenset({St.COMPLETED, St.FAILED, St.RETRY_SCHEDULED, St.REQUIRES_RECONCILIATION,
                             St.RUNNING}),
    St.RETRY_SCHEDULED: frozenset({St.RUNNING, St.PENDING, St.FAILED, St.CANCELLED, St.REQUIRES_RECONCILIATION,
                                   St.WAITING_APPROVAL}),
    St.REQUIRES_RECONCILIATION: frozenset({St.VERIFYING, St.RUNNING, St.PENDING, St.FAILED, St.COMPLETED,
                                           St.CANCELLED, St.WAITING_INPUT}),
    St.BLOCKED: frozenset({St.PENDING, St.FAILED, St.CANCELLED, St.SKIPPED}),
    St.FAILED: frozenset({St.PENDING}),  # explicit resume/re-run only
    St.COMPLETED: frozenset(),
    St.SKIPPED: frozenset({St.PENDING}),  # explicit resume only (dependency re-opened)
    St.CANCELLED: frozenset(),
}


def can_transition(current: str, target: str) -> bool:
    return TaskStatus(target) in TASK_TRANSITIONS[TaskStatus(current)]


async def append_event(session: AsyncSession, task: Task, event_type: EventType | str, *,
                       payload: dict[str, Any] | None = None, step_id: uuid.UUID | None = None,
                       actor_type: str = "system", actor_id: str | None = None) -> TaskEvent:
    """Append an immutable event. ``task`` must be locked (SELECT … FOR UPDATE) by the
    caller's transaction so that ``seq`` is gap-free and matches commit order."""
    task.event_seq = (task.event_seq or 0) + 1
    event = TaskEvent(tenant_id=task.tenant_id, task_id=task.id, seq=task.event_seq, event_type=str(event_type),
                      step_id=step_id, actor_type=actor_type, actor_id=actor_id, payload=payload or {})
    session.add(event)
    message = {"task_id": str(task.id), "seq": task.event_seq, "event_type": str(event_type),
               "status": task.status, "step_id": str(step_id) if step_id else None}
    add_outbox_event(session, topic=task_channel(task.id), event_type=str(event_type), payload=message,
                     tenant_id=task.tenant_id)
    add_outbox_event(session, topic=user_channel(task.user_id), event_type=str(event_type), payload=message,
                     tenant_id=task.tenant_id)
    return event


async def transition_task(session: AsyncSession, task: Task, target: TaskStatus, *, reason: str | None = None,
                          actor_type: str = "system", actor_id: str | None = None,
                          payload: dict[str, Any] | None = None) -> None:
    current = TaskStatus(task.status)
    if current == target:
        return
    if target not in TASK_TRANSITIONS[current]:
        raise InvalidStateTransition(
            f"Task cannot move from {current.value} to {target.value}",
            details={"from": current.value, "to": target.value},
        )
    task.status = target.value
    now = utcnow()
    if target == S.RUNNING and task.started_at is None:
        task.started_at = now
    if target in (S.COMPLETED, S.FAILED, S.CANCELLED, S.EXPIRED):
        task.completed_at = now
    if target in (S.COMPLETED, S.CANCELLED):
        task.lease_owner = None
        task.lease_expires_at = None
    metrics.task_state_transitions_total.labels(current.value, target.value).inc()
    event_type = {
        S.COMPLETED: EventType.TASK_COMPLETED,
        S.FAILED: EventType.TASK_FAILED,
        S.CANCELLED: EventType.TASK_CANCELLED,
        S.PAUSED: EventType.TASK_PAUSED,
        S.CANCEL_REQUESTED: EventType.CANCEL_REQUESTED,
    }.get(target, EventType.TASK_STATE_CHANGED)
    await append_event(session, task, event_type,
                       payload={"from": current.value, "to": target.value, "reason": reason, **(payload or {})},
                       actor_type=actor_type, actor_id=actor_id)


def transition_step(step: TaskStep, target: StepStatus) -> None:
    current = StepStatus(step.status)
    if current == target:
        return
    if target not in STEP_TRANSITIONS[current]:
        raise InvalidStateTransition(
            f"Step cannot move from {current.value} to {target.value}",
            details={"from": current.value, "to": target.value, "step": step.step_key},
        )
    step.status = target.value
    now = utcnow()
    if target == St.RUNNING and step.started_at is None:
        step.started_at = now
    if target in STEP_TERMINAL:
        step.completed_at = now
