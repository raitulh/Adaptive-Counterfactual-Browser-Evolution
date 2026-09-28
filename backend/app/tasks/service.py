"""Task use-cases for the API. The API only creates, inspects and steers tasks;
workers do the work. Every mutation happens under the task row lock and goes
through the state machine."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.service import resolve_agent
from app.approvals.service import cancel_for_task
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.billing.service import get_entitlements
from app.common.context import RequestContext
from app.common.enums import ErrorClass, VerificationStatus
from app.common.events import EventType
from app.common.time import utcnow
from app.core import metrics
from app.core.config import get_settings
from app.core.exceptions import Conflict, NotFound, QuotaExceeded, ValidationFailed
from app.execution.summary import build_summary
from app.organizations.rbac import P
from app.organizations.service import get_policy
from app.tasks import repository as repo
from app.tasks.models import ExternalAction, Task, TaskStep
from app.tasks.schemas import StepConfirmation, TaskCreate, TaskInput
from app.tasks.state import ACTIVE, StepStatus, TaskStatus, append_event, transition_step, transition_task
from app.tools.registry import ToolResolver
from app.usage.models import UsageKind
from app.usage.service import add_usage, enforce_quota
from app.verification.models import VerificationResult
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

_ACTIVE_VALUES = [s.value for s in ACTIVE] + [TaskStatus.WAITING_APPROVAL.value, TaskStatus.WAITING_INPUT.value]


def _execute_job(task: Task, delay: float = 0.0) -> JobSpec:
    return JobSpec(queue=Queues.EXECUTION, job_type="task.execute",
                   payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                   dedupe_key=f"task:{task.id}", tenant_id=task.tenant_id, priority=task.priority,
                   delay_seconds=delay)


def _plan_job(task: Task, mode: str) -> JobSpec:
    return JobSpec(queue=Queues.PLANNING, job_type="task.plan",
                   payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id), "mode": mode},
                   dedupe_key=f"plan:{task.id}", tenant_id=task.tenant_id, priority=task.priority)


async def create_task(session: AsyncSession, ctx: RequestContext, body: TaskCreate, *,
                      idempotency_key: str | None = None, source: str = "api",
                      automation_run_id: uuid.UUID | None = None) -> tuple[Task, bool]:
    """Returns (task, created). An existing task with the same Idempotency-Key is returned
    instead of creating a duplicate."""
    ctx.require(P.TASKS_CREATE)
    settings = get_settings()
    if idempotency_key:
        existing = (await session.execute(select(Task).where(
            Task.user_id == ctx.user_id, Task.idempotency_key == idempotency_key))).scalar_one_or_none()
        if existing is not None:
            if existing.goal != body.goal:
                raise ValidationFailed("Idempotency-Key was already used for a different task",
                                       code="idempotency_key_reused")
            return existing, False

    entitlements = await get_entitlements(session, ctx.tenant_id)
    await enforce_quota(session, ctx.tenant_id, entitlements.plan.name, UsageKind.TASK_CREATED)
    policy, _ = await get_policy(session, ctx.tenant_id)
    max_concurrent = min(settings.max_concurrent_tasks_per_user, entitlements.plan.max_concurrent_tasks,
                         policy.max_concurrent_tasks or 10**9)
    active = int((await session.execute(select(func.count()).select_from(Task).where(
        Task.user_id == ctx.user_id, Task.status.in_(_ACTIVE_VALUES)))).scalar_one())
    if active >= max_concurrent:
        raise QuotaExceeded(f"You already have {active} active tasks (limit {max_concurrent}).",
                            code="too_many_active_tasks", details={"limit": max_concurrent})

    agent = await resolve_agent(session, body.agent_id)
    limits = agent.execution_limits
    max_duration = min(body.max_duration_seconds or settings.max_task_duration_seconds,
                       limits.max_duration_seconds or settings.max_task_duration_seconds)
    budget = {
        "max_tool_calls": limits.max_tool_calls or settings.max_tool_calls_per_task,
        "max_model_calls": limits.max_model_calls or settings.max_model_calls_per_task,
        "max_browser_actions": limits.max_browser_actions if limits.max_browser_actions is not None
        else settings.max_browser_actions_per_task,
        "max_cost_usd": limits.max_cost_usd if limits.max_cost_usd is not None else settings.max_task_cost_usd,
        "max_duration_seconds": max_duration,
    }
    task = Task(tenant_id=ctx.tenant_id, user_id=ctx.user_id, agent_id=agent.agent_id,
                agent_version_id=agent.agent_version_id, goal=body.goal.strip(), priority=body.priority,
                source=source, idempotency_key=idempotency_key, automation_run_id=automation_run_id,
                budget=budget, deadline_at=utcnow() + timedelta(seconds=max_duration),
                input_context={"user_context": body.context} if body.context else {},
                execution_metadata={"agent": agent.as_metadata(), "region": settings.app_region})
    session.add(task)
    await session.flush()
    await append_event(session, task, EventType.TASK_CREATED, actor_type=ctx.actor_type, actor_id=str(ctx.user_id),
                       payload={"source": source})
    add_usage(session, tenant_id=ctx.tenant_id, user_id=ctx.user_id, task_id=task.id, agent_id=agent.agent_id,
              kind=UsageKind.TASK_CREATED)
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.create", task_id=task.id,
                 resource_type="task", resource_id=task.id, metadata={"source": source})
    await get_job_queue().enqueue(session, _plan_job(task, "initial"))
    metrics.task_created_total.labels(source).inc()
    return task, True


async def get_visible_task(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID) -> Task:
    task = await session.get(Task, task_id)
    if task is None or (task.user_id != ctx.user_id and not ctx.has(P.TASKS_READ_ALL)):
        raise NotFound("Task not found")
    return task


async def _lock_owned(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID) -> Task:
    await get_visible_task(session, ctx, task_id)
    task = await repo.lock_task(session, task_id)
    if task.user_id != ctx.user_id and not ctx.has(P.TASKS_READ_ALL):
        raise NotFound("Task not found")
    ctx.require(P.TASKS_CANCEL)
    return task


async def cancel_task(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID) -> Task:
    """Cooperative cancellation: tasks not being actively driven are cancelled now; running
    tasks get CANCEL_REQUESTED and stop at the next safe boundary."""
    task = await _lock_owned(session, ctx, task_id)
    status = TaskStatus(task.status)
    if status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
        raise Conflict(f"Task is already {status.value}", code="task_terminal")
    task.cancel_requested_at = utcnow()
    if status in (TaskStatus.CREATED, TaskStatus.QUEUED, TaskStatus.WAITING_APPROVAL, TaskStatus.WAITING_INPUT,
                  TaskStatus.PAUSED, TaskStatus.BLOCKED, TaskStatus.FAILED, TaskStatus.EXPIRED):
        for st in await repo.current_steps(session, task, lock=True):
            if st.status in (StepStatus.PENDING.value, StepStatus.WAITING_APPROVAL.value,
                             StepStatus.WAITING_INPUT.value, StepStatus.RETRY_SCHEDULED.value,
                             StepStatus.BLOCKED.value):
                transition_step(st, StepStatus.CANCELLED)
        await cancel_for_task(session, task, reason="task cancelled")
        await transition_task(session, task, TaskStatus.CANCELLED, reason="cancelled by user", actor_type="user",
                              actor_id=str(ctx.user_id))
        task.result_summary = await build_summary(session, task)
    elif status != TaskStatus.CANCEL_REQUESTED:
        await transition_task(session, task, TaskStatus.CANCEL_REQUESTED, reason="cancel requested",
                              actor_type="user", actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, _execute_job(task))
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.cancel", task_id=task.id)
    await session.commit()
    return task


async def pause_task(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID) -> Task:
    task = await _lock_owned(session, ctx, task_id)
    status = TaskStatus(task.status)
    if status in (TaskStatus.QUEUED, TaskStatus.WAITING_APPROVAL):
        await transition_task(session, task, TaskStatus.PAUSED, reason="paused by user", actor_type="user",
                              actor_id=str(ctx.user_id))
    elif status in (TaskStatus.RUNNING, TaskStatus.VERIFYING, TaskStatus.RECOVERING):
        task.pause_requested_at = utcnow()  # honoured by the engine at the next safe boundary
    else:
        raise Conflict(f"A {status.value} task cannot be paused", code="invalid_state_transition")
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.pause", task_id=task.id)
    await session.commit()
    return task


async def resume_task(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID) -> Task:
    """Resume a paused/expired/blocked or recoverably failed task."""
    task = await _lock_owned(session, ctx, task_id)
    status = TaskStatus(task.status)
    if status not in (TaskStatus.PAUSED, TaskStatus.EXPIRED, TaskStatus.BLOCKED, TaskStatus.FAILED,
                      TaskStatus.REQUIRES_RECONCILIATION):
        raise Conflict(f"A {status.value} task cannot be resumed", code="invalid_state_transition")
    if task.plan_version == 0:
        if status not in (TaskStatus.FAILED, TaskStatus.BLOCKED):
            raise Conflict("This task has no plan to resume", code="invalid_state_transition")
        task.failure_code = task.failure_message = None
        await transition_task(session, task, TaskStatus.PLANNING, reason="resumed; re-planning", actor_type="user",
                              actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, _plan_job(task, "resume"))
        audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.resume", task_id=task.id)
        await session.commit()
        return task
    for st in await repo.current_steps(session, task, lock=True):
        state = StepStatus(st.status)
        if state in (StepStatus.BLOCKED, StepStatus.FAILED) and st.error_class != ErrorClass.POLICY_BLOCKED.value:
            transition_step(st, StepStatus.PENDING)
            st.error_class = st.error_code = st.error_message = None
        elif state == StepStatus.SKIPPED:
            continue
        elif state == StepStatus.WAITING_APPROVAL:
            transition_step(st, StepStatus.PENDING)  # a fresh approval will be requested
        elif state == StepStatus.REQUIRES_RECONCILIATION:
            st.error_code = None  # let the engine try automatic reconciliation again
    # Previously skipped dependants of a resumed step get another chance.
    for st in await repo.current_steps(session, task, lock=True):
        if st.status == StepStatus.SKIPPED.value and st.error_message == \
                "Skipped because a step it depends on did not complete.":
            transition_step(st, StepStatus.PENDING)
            st.completed_at = None
            st.error_message = None
    task.failure_code = task.failure_message = None
    task.pause_requested_at = None
    task.deadline_at = max(task.deadline_at or utcnow(), utcnow() + timedelta(
        seconds=int(task.budget.get("max_duration_seconds", 3600))))
    await transition_task(session, task, TaskStatus.QUEUED, reason="resumed by user", actor_type="user",
                          actor_id=str(ctx.user_id))
    await append_event(session, task, EventType.TASK_RESUMED, actor_type="user", actor_id=str(ctx.user_id))
    await get_job_queue().enqueue(session, _execute_job(task))
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.resume", task_id=task.id)
    await session.commit()
    return task


async def provide_input(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID, body: TaskInput) -> Task:
    task = await _lock_owned(session, ctx, task_id)
    if task.status != TaskStatus.WAITING_INPUT.value:
        raise Conflict("The task is not waiting for input", code="not_waiting_for_input")
    question = (task.pending_questions or ["(question)"])[0]
    meta = dict(task.input_context or {})
    answers = list(meta.get("user_inputs", []))
    answers.append({"question": question, "answer": body.answer, "at": utcnow().isoformat()})
    meta["user_inputs"] = answers[-20:]
    pending = meta.pop("pending_input", None)
    task.input_context = meta
    task.pending_questions = None
    await append_event(session, task, EventType.INPUT_RECEIVED, actor_type="user", actor_id=str(ctx.user_id),
                       payload={"question": question[:300]})
    resumed_step = False
    if pending and pending.get("step_id"):
        step = await repo.lock_step(session, uuid.UUID(pending["step_id"]))
        if step.status == StepStatus.WAITING_INPUT.value and step.plan_version == task.plan_version:
            tool = await ToolResolver().resolve(session, task.tenant_id, step.tool_name, step.tool_version)
            args = tool.parse_args(step.resolved_arguments or {})
            result = tool.output_from_user_input(args, body.answer, pending.get("details") or {})
            if result is not None:
                transition_step(step, StepStatus.PENDING)
                transition_step(step, StepStatus.RUNNING)
                step.output = result.output
                step.output_summary = result.summary
                step.output_trust = "controlled_agent_output"
                transition_step(step, StepStatus.VERIFYING)
                transition_step(step, StepStatus.COMPLETED)
                step.verification_status = VerificationStatus.PASSED.value
                step.verification_method = "user_input"
                step.error_class = step.error_code = step.error_message = None
                session.add(VerificationResult(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                                               status=VerificationStatus.PASSED.value, method="user_input",
                                               evidence={"source": "answer provided by the user"}))
                await append_event(session, task, EventType.STEP_COMPLETED, step_id=step.id,
                                   payload={"step": step.step_key, "summary": result.summary, "source": "user"})
                resumed_step = True
    if resumed_step:
        await transition_task(session, task, TaskStatus.QUEUED, reason="input received", actor_type="user",
                              actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, _execute_job(task))
    else:
        await transition_task(session, task, TaskStatus.PLANNING, reason="re-planning with user input",
                              actor_type="user", actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, _plan_job(task, "input"))
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.input", task_id=task.id)
    await session.commit()
    return task


async def confirm_step(session: AsyncSession, ctx: RequestContext, task_id: uuid.UUID, step_id: uuid.UUID,
                       body: StepConfirmation) -> Task:
    """Human reconciliation for an action whose outcome could not be determined or verified."""
    task = await _lock_owned(session, ctx, task_id)
    step = await repo.lock_step(session, step_id)
    if step.task_id != task.id or step.status != StepStatus.REQUIRES_RECONCILIATION.value:
        raise Conflict("This step is not awaiting confirmation", code="step_not_awaiting_confirmation")
    ledger = (await session.execute(select(ExternalAction).where(
        ExternalAction.idempotency_key == step.idempotency_key).with_for_update())).scalar_one_or_none()
    if body.outcome == "succeeded":
        transition_step(step, StepStatus.COMPLETED)
        step.verification_status = VerificationStatus.PASSED.value
        step.verification_method = "user_confirmation"
        if ledger is not None:
            ledger.status, ledger.reconciled_at = "succeeded", utcnow()
        session.add(VerificationResult(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                                       status=VerificationStatus.PASSED.value, method="user_confirmation",
                                       evidence={"confirmed_by": str(ctx.user_id), "note": body.note}))
    else:
        if ledger is not None:
            ledger.status, ledger.reconciled_at = "failed", utcnow()
        transition_step(step, StepStatus.PENDING)
    step.error_class = step.error_code = step.error_message = None
    await append_event(session, task, EventType.RECONCILIATION_RESOLVED, step_id=step.id, actor_type="user",
                       actor_id=str(ctx.user_id), payload={"step": step.step_key, "outcome": body.outcome})
    if task.status in (TaskStatus.REQUIRES_RECONCILIATION.value,):
        await transition_task(session, task, TaskStatus.QUEUED, reason="user confirmed outcome", actor_type="user",
                              actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, _execute_job(task))
    audit.record(session, ctx=ctx, category=AuditCategory.TASK, action="task.step.confirm", task_id=task.id,
                 step_id=step.id, metadata={"outcome": body.outcome})
    await session.commit()
    return task


def reproducibility(task: Task) -> dict[str, Any]:
    meta = task.execution_metadata or {}
    return {
        "agent": meta.get("agent"),
        "agent_version_id": str(task.agent_version_id) if task.agent_version_id else None,
        "model": (meta.get("planner") or {}).get("model"),
        "tool_versions": (task.plan or {}).get("tool_versions", {}),
        "policy_version": task.policy_version,
        "strategy_version": task.strategy_version,
        "plan_version": task.plan_version,
        "region": meta.get("region"),
    }


async def step_list(session: AsyncSession, task: Task) -> list[TaskStep]:
    return await repo.all_steps(session, task.id)
