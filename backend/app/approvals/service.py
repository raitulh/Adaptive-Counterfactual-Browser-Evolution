"""Approval engine.

Invariants:
* approvals are durable rows, never implied by model output;
* an approval is bound to one concrete action (``action_hash`` of tool +
  resolved arguments), expires, and is re-validated at execution time;
* an approval can be consumed exactly once (atomic compare-and-set), so it can
  never be replayed for a second execution.
"""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.approvals.models import ApprovalAction, ApprovalRequest
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.enums import ApprovalStatus
from app.common.events import EventType
from app.common.redaction import redact
from app.common.sanitize import bound_structure
from app.common.time import ensure_aware, utcnow
from app.core import metrics
from app.core.config import get_settings
from app.core.exceptions import ApprovalInvalid, Conflict, NotFound
from app.notifications.service import NotificationEvent, notify
from app.organizations.rbac import P
from app.tasks import repository as task_repo
from app.tasks.models import Task, TaskStep
from app.tasks.state import StepStatus, TaskStatus, append_event, transition_step, transition_task
from app.tools.base import Tool
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue


def arguments_preview(tool: Tool[Any, Any], args: dict[str, Any]) -> dict[str, Any]:
    preview = dict(args)
    for field in tool.spec.audit_policy.redact_fields:
        if field in preview:
            preview[field] = "[REDACTED]"
    return bound_structure(redact(preview), max_depth=4, max_items=30, max_string=2000)


async def find_valid_approval(session: AsyncSession, step: TaskStep, action_hash: str) -> ApprovalRequest | None:
    settings = get_settings()
    now = utcnow()
    rows = (await session.execute(
        select(ApprovalRequest).where(ApprovalRequest.step_id == step.id,
                                      ApprovalRequest.action_hash == action_hash,
                                      ApprovalRequest.status == ApprovalStatus.APPROVED.value,
                                      ApprovalRequest.consumed_at.is_(None))
        .order_by(ApprovalRequest.approved_at.desc())
    )).scalars().all()
    for row in rows:
        approved_at = ensure_aware(row.approved_at) if row.approved_at else None
        if approved_at and now - approved_at <= timedelta(seconds=settings.approval_execution_window_seconds):
            return row
    return None


async def pending_approval(session: AsyncSession, step: TaskStep, action_hash: str) -> ApprovalRequest | None:
    return (await session.execute(
        select(ApprovalRequest).where(ApprovalRequest.step_id == step.id,
                                      ApprovalRequest.action_hash == action_hash,
                                      ApprovalRequest.status == ApprovalStatus.PENDING.value)
    )).scalar_one_or_none()


async def consume(session: AsyncSession, approval: ApprovalRequest, *, step: TaskStep, action_hash: str) -> None:
    """Atomically mark the approval used. Fails if already consumed, revoked, expired or
    if the action changed since approval (replay / TOCTOU protection)."""
    if approval.action_hash != action_hash or approval.step_id != step.id:
        raise ApprovalInvalid("Approval does not match the action being executed")
    result = await session.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.id == approval.id, ApprovalRequest.consumed_at.is_(None),
               ApprovalRequest.status == ApprovalStatus.APPROVED.value,
               ApprovalRequest.action_hash == action_hash)
        .values(consumed_at=utcnow(), version=ApprovalRequest.version + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount != 1:  # type: ignore[attr-defined]
        raise ApprovalInvalid("Approval was already used or is no longer valid")
    session.add(ApprovalAction(tenant_id=approval.tenant_id, approval_request_id=approval.id, action="consumed",
                               actor_type="worker"))


async def request_approval(session: AsyncSession, *, task: Task, step: TaskStep, tool: Tool[Any, Any],
                           resolved_args: dict[str, Any], action_hash: str, risk_level: str, permission_level: str,
                           reasons: list[str], summary: str, target: str | None,
                           ttl_seconds: int | None = None) -> ApprovalRequest:
    existing = await pending_approval(session, step, action_hash)
    if existing is not None:
        return existing
    ttl = ttl_seconds or get_settings().approval_ttl_seconds
    approval = ApprovalRequest(
        tenant_id=task.tenant_id, task_id=task.id, step_id=step.id, user_id=task.user_id, action=tool.spec.name,
        tool_name=tool.spec.name, tool_version=tool.spec.version, summary=summary[:2000], target=target,
        arguments_preview=arguments_preview(tool, resolved_args), action_hash=action_hash, risk_level=risk_level,
        permission_level=permission_level, reasons=reasons, status=ApprovalStatus.PENDING.value,
        expires_at=utcnow() + timedelta(seconds=ttl),
    )
    session.add(approval)
    await session.flush()
    session.add(ApprovalAction(tenant_id=task.tenant_id, approval_request_id=approval.id, action="created",
                               actor_type="worker"))
    step.approval_request_id = approval.id
    await append_event(session, task, EventType.APPROVAL_REQUIRED, step_id=step.id,
                       payload={"approval_id": str(approval.id), "summary": approval.summary,
                                "risk_level": risk_level, "expires_at": approval.expires_at.isoformat()})
    await notify(session, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.APPROVAL_REQUIRED,
                 title="Approval needed", body=approval.summary,
                 data={"approval_id": str(approval.id), "task_id": str(task.id)},
                 idempotency_key=f"approval:{approval.id}")
    audit.record(session, category=AuditCategory.APPROVAL, action="approval.requested", tenant_id=task.tenant_id,
                 user_id=task.user_id, actor_type="worker", task_id=task.id, step_id=step.id,
                 tool_name=tool.spec.name, approval_id=approval.id, resource_type="approval",
                 resource_id=approval.id, metadata={"risk_level": risk_level, "reasons": reasons})
    metrics.approval_requests_total.labels("requested").inc()
    return approval


async def _load_for_decision(session: AsyncSession, ctx: RequestContext, approval_id: uuid.UUID
                             ) -> ApprovalRequest:
    # No lock here: lock order is always task → approval (same as the execution engine).
    approval = await session.get(ApprovalRequest, approval_id)
    if approval is None:
        raise NotFound("Approval not found")
    own = approval.user_id == ctx.user_id and ctx.has(P.APPROVALS_DECIDE)
    if not (own or ctx.has(P.APPROVALS_DECIDE_ANY)):
        # Do not reveal the existence of other users' approvals.
        raise NotFound("Approval not found")
    return approval


async def approve(session: AsyncSession, ctx: RequestContext, approval_id: uuid.UUID, note: str | None = None
                  ) -> ApprovalRequest:
    approval = await _load_for_decision(session, ctx, approval_id)
    task = await task_repo.lock_task(session, approval.task_id)
    approval = (await session.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
                                      .with_for_update().execution_options(populate_existing=True))).scalar_one()
    now = utcnow()
    if approval.status != ApprovalStatus.PENDING.value:
        raise Conflict(f"Approval is already {approval.status}", code="approval_not_pending")
    if ensure_aware(approval.expires_at) <= now:
        approval.status = ApprovalStatus.EXPIRED.value
        session.add(ApprovalAction(tenant_id=approval.tenant_id, approval_request_id=approval.id, action="expired",
                                   actor_type="system"))
        await session.commit()
        raise Conflict("Approval has expired", code="approval_expired")
    if TaskStatus(task.status) in (TaskStatus.CANCELLED, TaskStatus.COMPLETED, TaskStatus.CANCEL_REQUESTED):
        raise Conflict("Task is no longer active", code="task_not_active")
    approval.status = ApprovalStatus.APPROVED.value
    approval.approved_by = ctx.user_id
    approval.approved_at = now
    session.add(ApprovalAction(tenant_id=approval.tenant_id, approval_request_id=approval.id, action="approved",
                               actor_id=str(ctx.user_id), reason=note, ip_address=ctx.ip,
                               user_agent=ctx.user_agent))
    step = await task_repo.lock_step(session, approval.step_id)
    if step.status == StepStatus.WAITING_APPROVAL.value:
        transition_step(step, StepStatus.PENDING)
    await append_event(session, task, EventType.APPROVAL_GRANTED, step_id=step.id, actor_type="user",
                       actor_id=str(ctx.user_id), payload={"approval_id": str(approval.id)})
    if task.status == TaskStatus.WAITING_APPROVAL.value:
        await transition_task(session, task, TaskStatus.QUEUED, reason="approval granted", actor_type="user",
                              actor_id=str(ctx.user_id))
    await get_job_queue().enqueue(session, JobSpec(queue=Queues.EXECUTION, job_type="task.execute",
                                                   payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                                                   dedupe_key=f"task:{task.id}", tenant_id=task.tenant_id,
                                                   priority=task.priority))
    audit.record(session, ctx=ctx, category=AuditCategory.APPROVAL, action="approval.approved", task_id=task.id,
                 step_id=step.id, tool_name=approval.tool_name, approval_id=approval.id, resource_type="approval",
                 resource_id=approval.id, metadata={"risk_level": approval.risk_level})
    metrics.approval_requests_total.labels("approved").inc()
    metrics.approval_wait_time.observe((now - ensure_aware(approval.created_at)).total_seconds())
    await session.commit()
    return approval


async def reject(session: AsyncSession, ctx: RequestContext, approval_id: uuid.UUID, reason: str
                 ) -> ApprovalRequest:
    approval = await _load_for_decision(session, ctx, approval_id)
    task = await task_repo.lock_task(session, approval.task_id)
    approval = (await session.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
                                      .with_for_update().execution_options(populate_existing=True))).scalar_one()
    if approval.status != ApprovalStatus.PENDING.value:
        raise Conflict(f"Approval is already {approval.status}", code="approval_not_pending")
    now = utcnow()
    approval.status = ApprovalStatus.REJECTED.value
    approval.rejected_by = ctx.user_id
    approval.rejected_at = now
    approval.rejection_reason = reason
    session.add(ApprovalAction(tenant_id=approval.tenant_id, approval_request_id=approval.id, action="rejected",
                               actor_id=str(ctx.user_id), reason=reason, ip_address=ctx.ip,
                               user_agent=ctx.user_agent))
    step = await task_repo.lock_step(session, approval.step_id)
    if step.status in (StepStatus.WAITING_APPROVAL.value, StepStatus.PENDING.value):
        transition_step(step, StepStatus.FAILED)
        step.error_class = "policy_blocked"
        step.error_code = "approval_rejected"
        step.error_message = f"Rejected by user: {reason[:500]}"
    await append_event(session, task, EventType.APPROVAL_REJECTED, step_id=step.id, actor_type="user",
                       actor_id=str(ctx.user_id), payload={"approval_id": str(approval.id), "reason": reason[:500]})
    if task.status == TaskStatus.WAITING_APPROVAL.value:
        await transition_task(session, task, TaskStatus.QUEUED, reason="approval rejected; finalizing",
                              actor_type="user", actor_id=str(ctx.user_id))
        await get_job_queue().enqueue(session, JobSpec(
            queue=Queues.EXECUTION, job_type="task.execute",
            payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)}, dedupe_key=f"task:{task.id}",
            tenant_id=task.tenant_id, priority=task.priority))
    audit.record(session, ctx=ctx, category=AuditCategory.APPROVAL, action="approval.rejected", task_id=task.id,
                 step_id=step.id, tool_name=approval.tool_name, approval_id=approval.id, resource_type="approval",
                 resource_id=approval.id, metadata={"reason": reason[:300]})
    metrics.approval_requests_total.labels("rejected").inc()
    metrics.approval_wait_time.observe((now - ensure_aware(approval.created_at)).total_seconds())
    await session.commit()
    return approval


async def cancel_for_task(session: AsyncSession, task: Task, *, reason: str) -> int:
    rows = (await session.execute(
        select(ApprovalRequest).where(ApprovalRequest.task_id == task.id,
                                      ApprovalRequest.status == ApprovalStatus.PENDING.value).with_for_update()
    )).scalars().all()
    for row in rows:
        row.status = ApprovalStatus.CANCELLED.value
        session.add(ApprovalAction(tenant_id=row.tenant_id, approval_request_id=row.id, action="cancelled",
                                   actor_type="system", reason=reason))
    return len(rows)


async def expire_due(session: AsyncSession, *, limit: int = 500) -> int:
    """Maintenance (system scope): expire overdue approvals and park their tasks as EXPIRED.
    Lock order task → approval, matching the engine and the decision endpoints."""
    now = utcnow()
    candidates = (await session.execute(
        select(ApprovalRequest.id, ApprovalRequest.task_id).where(
            ApprovalRequest.status == ApprovalStatus.PENDING.value, ApprovalRequest.expires_at < now)
        .order_by(ApprovalRequest.expires_at).limit(limit)
    )).all()
    expired = 0
    for approval_id, task_id in candidates:
        task = await task_repo.lock_task(session, task_id)
        approval = (await session.execute(select(ApprovalRequest).where(ApprovalRequest.id == approval_id)
                                          .with_for_update().execution_options(populate_existing=True))).scalar_one()
        if approval.status != ApprovalStatus.PENDING.value or ensure_aware(approval.expires_at) >= now:
            await session.commit()
            continue
        approval.status = ApprovalStatus.EXPIRED.value
        session.add(ApprovalAction(tenant_id=approval.tenant_id, approval_request_id=approval.id, action="expired",
                                   actor_type="system"))
        await append_event(session, task, EventType.APPROVAL_EXPIRED, step_id=approval.step_id,
                           payload={"approval_id": str(approval.id)})
        if task.status == TaskStatus.WAITING_APPROVAL.value:
            await transition_task(session, task, TaskStatus.EXPIRED, reason="approval expired")
        audit.record(session, category=AuditCategory.APPROVAL, action="approval.expired", tenant_id=task.tenant_id,
                     user_id=task.user_id, actor_type="system", task_id=task.id, approval_id=approval.id)
        metrics.approval_requests_total.labels("expired").inc()
        await session.commit()
        expired += 1
    return expired
