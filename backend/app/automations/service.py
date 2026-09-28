"""Automation use-cases.

* API: create / list / update / soft-delete automations, list runs, run now.
* Scheduler (``enqueue_due_automations``): turns each due occurrence into exactly one
  ``AutomationRun`` + one task created on behalf of the owner (never runs the workflow).
* Maintenance (``sync_run_outcomes``): mirrors task outcomes onto runs, counts consecutive
  failures, notifies the owner and pauses failing automations.

The owner's authority is re-derived from their *current* membership every time a run is
materialized: an automation can never do more than its owner could do right now.
"""

from __future__ import annotations

import contextlib
import logging
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta

from pydantic import ValidationError
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.automations.models import Automation, AutomationRun, RunStatus
from app.automations.schemas import (
    AutomationCreate,
    AutomationOut,
    AutomationPolicy,
    AutomationRunOut,
    AutomationUpdate,
    RetryPolicy,
    TaskTemplate,
    next_run_from,
)
from app.common.context import RequestContext
from app.common.ids import new_id
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.common.time import ensure_aware, utcnow
from app.core.database import set_tenant_scope
from app.core.exceptions import AppError, Conflict, NotFound, QuotaExceeded, RateLimited, ServiceUnavailable
from app.notifications.service import NotificationEvent, notify
from app.organizations import repository as org_repo
from app.organizations.models import Organization
from app.organizations.rbac import P
from app.tasks.models import Task
from app.tasks.schemas import TaskCreate
from app.tasks.state import TaskStatus
from app.usage.models import UsageKind
from app.users.models import User, UserStatus

logger = logging.getLogger("agentos.automations")

_NO_SCOPE = {"skip_tenant_scope": True}

# Why the system disabled an automation (``Automation.disabled_reason``).
REASON_PAUSED = "paused_after_failures"
REASON_ACCESS_LOST = "owner_access_lost"
REASON_MAX_RUNS = "max_runs_reached"
REASON_NO_SCHEDULE = "schedule_exhausted"

# Task states that settle a run. FAILED/EXPIRED/BLOCKED can technically be resumed by the
# user, but for a recurring job the occurrence has failed; a resumed task does not re-open it.
_RUN_OUTCOME: dict[str, str] = {
    TaskStatus.COMPLETED.value: RunStatus.SUCCEEDED,
    TaskStatus.FAILED.value: RunStatus.FAILED,
    TaskStatus.EXPIRED.value: RunStatus.FAILED,
    TaskStatus.BLOCKED.value: RunStatus.FAILED,
    TaskStatus.CANCELLED.value: RunStatus.FAILED,
}


# ============================================================================ helpers
@contextlib.contextmanager
def _tenant_scope(session: AsyncSession, tenant_id: uuid.UUID) -> Iterator[None]:
    """Run a block in one tenant's scope on a (system) session, then restore the prior scope."""
    saved = {key: session.info.get(key) for key in ("tenant_id", "system")}
    set_tenant_scope(session, tenant_id)
    try:
        yield
    finally:
        session.info.pop("tenant_id", None)
        session.info.pop("system", None)
        for key, value in saved.items():
            if value is not None:
                session.info[key] = value


def _retry_policy(automation: Automation) -> RetryPolicy:
    try:
        return RetryPolicy.model_validate(automation.retry_policy or {})
    except ValidationError:
        return RetryPolicy()


def _policy(automation: Automation) -> AutomationPolicy:
    try:
        return AutomationPolicy.model_validate(automation.policy or {})
    except ValidationError:
        return AutomationPolicy()


def _disable(automation: Automation, reason: str | None) -> None:
    automation.enabled = False
    automation.next_run_at = None
    automation.disabled_reason = reason


def _finish(run: AutomationRun, status: str, error: str | None, now: datetime) -> None:
    run.status = status
    run.error = error
    run.finished_at = now
    run.next_attempt_at = None


def _run_key(automation_id: uuid.UUID, scheduled_for: datetime) -> str:
    return f"automation:{automation_id}:{ensure_aware(scheduled_for).isoformat()}"


def _is_transient(exc: Exception) -> bool:
    if isinstance(exc, ServiceUnavailable | RateLimited):
        return True
    return isinstance(exc, QuotaExceeded) and exc.code == "too_many_active_tasks"


async def owner_context(session: AsyncSession, automation: Automation) -> RequestContext | None:
    """The owner's authority *now*: None when the user is gone/disabled, no longer an active
    member of the tenant, or may no longer create tasks."""
    user = await session.get(User, automation.user_id)
    if user is None or user.deleted_at is not None or user.status != UserStatus.ACTIVE:
        return None
    membership = await org_repo.get_active_membership(session, automation.user_id, automation.tenant_id)
    if membership is None:
        return None
    _, role, _ = membership
    permissions = await org_repo.role_permissions(session, role.id)
    if P.TASKS_CREATE not in permissions:
        return None
    return RequestContext(user_id=user.id, tenant_id=automation.tenant_id, role=role.name,
                          permissions=permissions, timezone=user.timezone, email=user.email,
                          actor_type="automation")


# ============================================================================ materialization
async def _record_failure(session: AsyncSession, automation: Automation, run: AutomationRun, code: str,
                          *, count: bool = True) -> None:
    automation.last_status = RunStatus.FAILED
    if not count:
        return
    automation.consecutive_failures = (automation.consecutive_failures or 0) + 1
    policy = _policy(automation)
    paused = (policy.pause_on_failure and automation.enabled
              and automation.consecutive_failures >= policy.max_consecutive_failures)
    if paused:
        _disable(automation, REASON_PAUSED)
        audit.record(session, category=AuditCategory.AUTOMATION, action="automation.paused", status="failure",
                     tenant_id=automation.tenant_id, user_id=automation.user_id, actor_type="system",
                     resource_type="automation", resource_id=automation.id,
                     metadata={"consecutive_failures": automation.consecutive_failures, "last_error": code})
    body = f"The run scheduled for {ensure_aware(run.scheduled_for).isoformat()} failed ({code})."
    if paused:
        body += (f" The automation was paused after {automation.consecutive_failures} consecutive failures;"
                 " re-enable it once the problem is fixed.")
    await notify(session, tenant_id=automation.tenant_id, user_id=automation.user_id,
                 event=NotificationEvent.AUTOMATION_FAILED,
                 title=f"Automation '{automation.name[:120]}' failed" + (" and was paused" if paused else ""),
                 body=body, idempotency_key=f"automation_failed:{run.id}",
                 data={"automation_id": str(automation.id), "run_id": str(run.id),
                       "task_id": str(run.task_id) if run.task_id else None, "code": code, "paused": paused})


async def _skip_for_lost_access(session: AsyncSession, automation: Automation, run: AutomationRun,
                                now: datetime) -> None:
    _finish(run, RunStatus.SKIPPED, REASON_ACCESS_LOST, now)
    automation.last_status = RunStatus.SKIPPED
    _disable(automation, REASON_ACCESS_LOST)
    audit.record(session, category=AuditCategory.AUTOMATION, action="automation.disabled", status="failure",
                 tenant_id=automation.tenant_id, user_id=automation.user_id, actor_type="system",
                 resource_type="automation", resource_id=automation.id,
                 metadata={"reason": REASON_ACCESS_LOST, "run_id": str(run.id)})
    logger.info("automation disabled: owner lost access", extra={"automation_id": str(automation.id)})


async def _attempt(session: AsyncSession, automation: Automation, run: AutomationRun, now: datetime, *,
                   ctx: RequestContext | None = None) -> Task | None:
    """Try to create the run's task in the automation's tenant scope. Never commits.
    Returns the task, or None when the run was skipped, failed or scheduled for a retry."""
    from app.billing.service import get_entitlements
    from app.tasks.service import create_task
    from app.usage.service import enforce_quota, record_usage_once

    with _tenant_scope(session, automation.tenant_id):
        owner = ctx or await owner_context(session, automation)
        if owner is None:
            await _skip_for_lost_access(session, automation, run, now)
            return None
        run.attempts = (run.attempts or 0) + 1
        try:
            template = TaskTemplate.model_validate(automation.task_template or {})
            body = TaskCreate(goal=template.goal, agent_id=template.agent_id, context=template.context,
                              priority=template.priority, max_duration_seconds=template.max_duration_seconds)
        except ValidationError:
            _finish(run, RunStatus.FAILED, "invalid_template", now)
            await _record_failure(session, automation, run, "invalid_template")
            return None
        try:
            async with session.begin_nested():
                entitlements = await get_entitlements(session, automation.tenant_id)
                await enforce_quota(session, automation.tenant_id, entitlements.plan.name,
                                    UsageKind.AUTOMATION_RUN)
                task, _ = await create_task(session, owner, body, source="automation",
                                            automation_run_id=run.id,
                                            idempotency_key=_run_key(automation.id, run.scheduled_for))
        except Exception as exc:
            code = exc.code if isinstance(exc, AppError) else "internal_error"
            if not isinstance(exc, AppError):
                logger.exception("automation run materialization failed",
                                 extra={"automation_id": str(automation.id), "run_id": str(run.id)})
            policy = _retry_policy(automation)
            if _is_transient(exc) and run.attempts < policy.max_attempts:
                run.error = code
                delay = policy.backoff_seconds * 2 ** (run.attempts - 1)
                run.next_attempt_at = now + timedelta(seconds=delay)
                return None
            _finish(run, RunStatus.FAILED, code, now)
            await _record_failure(session, automation, run, code)
            return None

        run.task_id = task.id
        run.error = None
        run.next_attempt_at = None
        automation.last_run_at = now
        automation.last_status = RunStatus.CREATED
        await record_usage_once(session, idempotency_key=f"automation_run:{run.id}",
                                tenant_id=automation.tenant_id, kind=UsageKind.AUTOMATION_RUN,
                                user_id=automation.user_id, task_id=task.id,
                                metadata={"automation_id": str(automation.id), "trigger": run.trigger})
        return task


async def _insert_run(session: AsyncSession, automation: Automation, scheduled_for: datetime, trigger: str,
                      now: datetime) -> AutomationRun | None:
    """Exactly-once run row per (automation, scheduled_for); None if it already exists."""
    run_id = (await session.execute(
        insert(AutomationRun).values(
            id=new_id(), tenant_id=automation.tenant_id, automation_id=automation.id,
            scheduled_for=scheduled_for, trigger=trigger, status=RunStatus.CREATED, attempts=0,
            created_at=now,
        ).on_conflict_do_nothing(index_elements=["automation_id", "scheduled_for"])
        .returning(AutomationRun.id)
    )).scalar_one_or_none()
    if run_id is None:
        return None
    return await session.get(AutomationRun, run_id)


def _advance_schedule(automation: Automation, scheduled_for: datetime, now: datetime) -> None:
    try:
        automation.next_run_at = next_run_from(automation.cron_expression, automation.timezone, now=now,
                                               after=scheduled_for)
    except ValueError:
        _disable(automation, REASON_NO_SCHEDULE)


async def _materialize_due(session: AsyncSession, automation: Automation, now: datetime) -> bool:
    assert automation.next_run_at is not None
    scheduled_for = ensure_aware(automation.next_run_at)
    # Advance first: whatever happens to this occurrence, it is never materialized twice and a
    # scheduler outage yields at most one catch-up run.
    _advance_schedule(automation, scheduled_for, now)
    with _tenant_scope(session, automation.tenant_id):
        run = await _insert_run(session, automation, scheduled_for, "schedule", now)
    if run is None:
        return False
    task = await _attempt(session, automation, run, now)
    if task is None:
        return False
    automation.run_count = (automation.run_count or 0) + 1
    if automation.max_runs is not None and automation.run_count >= automation.max_runs:
        _disable(automation, REASON_MAX_RUNS)
    return True


async def _lock_automation(session: AsyncSession, automation_id: uuid.UUID, *, skip_locked: bool = True
                           ) -> Automation | None:
    return (await session.execute(
        select(Automation).where(Automation.id == automation_id)
        .with_for_update(skip_locked=skip_locked).execution_options(populate_existing=True, **_NO_SCOPE)
    )).scalar_one_or_none()


async def _retry_pending_runs(session: AsyncSession, now: datetime, limit: int) -> int:
    candidates = (await session.execute(
        select(AutomationRun.id, AutomationRun.automation_id).where(
            AutomationRun.status == RunStatus.CREATED, AutomationRun.task_id.is_(None),
            AutomationRun.next_attempt_at.is_not(None), AutomationRun.next_attempt_at <= now)
        .order_by(AutomationRun.next_attempt_at).limit(limit), execution_options=_NO_SCOPE,
    )).all()
    await session.rollback()
    created = 0
    for run_id, automation_id in candidates:
        try:
            automation = await _lock_automation(session, automation_id)
            run = (await session.execute(
                select(AutomationRun).where(AutomationRun.id == run_id).with_for_update(skip_locked=True)
                .execution_options(populate_existing=True, **_NO_SCOPE))).scalar_one_or_none()
            retryable = (run is not None and run.status == RunStatus.CREATED and run.task_id is None
                         and run.next_attempt_at is not None and ensure_aware(run.next_attempt_at) <= now)
            if automation is None or run is None or not retryable:
                await session.rollback()
                continue
            if automation.deleted_at is not None or (not automation.enabled and run.trigger == "schedule"):
                _finish(run, RunStatus.SKIPPED, "automation_disabled", now)
            elif await _attempt(session, automation, run, now) is not None:
                created += 1
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception("automation run retry failed", extra={"run_id": str(run_id)})
    return created


async def enqueue_due_automations(session: AsyncSession, *, now: datetime, limit: int = 200) -> int:
    """Scheduler entry point (system-scoped session). Materializes due occurrences into runs and
    tasks — one transaction and one ``FOR UPDATE SKIP LOCKED`` row lock per automation, so
    concurrent scheduler replicas never double-create — and retries runs whose task could not
    be created yet. Returns the number of tasks created. Never executes the workflow."""
    now = ensure_aware(now)
    due_ids = list((await session.execute(
        select(Automation.id).where(Automation.enabled.is_(True), Automation.deleted_at.is_(None),
                                    Automation.next_run_at.is_not(None), Automation.next_run_at <= now)
        .order_by(Automation.next_run_at).limit(limit), execution_options=_NO_SCOPE,
    )).scalars().all())
    await session.rollback()
    created = 0
    for automation_id in due_ids:
        try:
            automation = await _lock_automation(session, automation_id)
            if automation is None or not automation.enabled or automation.deleted_at is not None \
                    or automation.next_run_at is None or ensure_aware(automation.next_run_at) > now:
                await session.rollback()  # locked by another scheduler, or already advanced
                continue
            if await _materialize_due(session, automation, now):
                created += 1
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception("automation materialization failed", extra={"automation_id": str(automation_id)})
    created += await _retry_pending_runs(session, now, limit)
    return created


# ============================================================================ outcome sync
async def sync_run_outcomes(session: AsyncSession, *, limit: int = 200) -> int:
    """Maintenance (system scope): settle open runs whose task reached an outcome, maintain
    ``consecutive_failures``, notify the owner and pause after too many failures. Idempotent."""
    now = utcnow()
    settled = list((await session.execute(
        select(AutomationRun.id, AutomationRun.automation_id)
        .join(Task, Task.id == AutomationRun.task_id)
        .where(AutomationRun.status == RunStatus.CREATED, Task.status.in_(list(_RUN_OUTCOME)))
        .order_by(AutomationRun.created_at).limit(limit), execution_options=_NO_SCOPE,
    )).all())
    orphaned = list((await session.execute(
        select(AutomationRun.id, AutomationRun.automation_id).where(
            AutomationRun.status == RunStatus.CREATED, AutomationRun.task_id.is_(None),
            AutomationRun.next_attempt_at.is_(None))
        .order_by(AutomationRun.created_at).limit(limit), execution_options=_NO_SCOPE,
    )).all())
    await session.rollback()
    count = 0
    for run_id, automation_id in [*settled, *orphaned]:
        try:
            if await _settle_run(session, run_id, automation_id, now):
                count += 1
            await session.commit()
        except Exception:
            await session.rollback()
            logger.exception("automation run sync failed", extra={"run_id": str(run_id)})
    return count


async def _settle_run(session: AsyncSession, run_id: uuid.UUID, automation_id: uuid.UUID,
                      now: datetime) -> bool:
    automation = await _lock_automation(session, automation_id, skip_locked=False)
    run = (await session.execute(
        select(AutomationRun).where(AutomationRun.id == run_id).with_for_update()
        .execution_options(populate_existing=True, **_NO_SCOPE))).scalar_one_or_none()
    if automation is None or run is None or run.status != RunStatus.CREATED:
        return False
    with _tenant_scope(session, automation.tenant_id):
        if run.task_id is None:
            if run.next_attempt_at is not None:
                return False
            run.status, run.error, run.finished_at = RunStatus.SKIPPED, "task_deleted", now
            return True
        task = await session.get(Task, run.task_id, populate_existing=True)
        if task is None or task.status not in _RUN_OUTCOME:
            return False
        run.status = _RUN_OUTCOME[task.status]
        run.finished_at = now
        if run.status == RunStatus.SUCCEEDED:
            run.error = None
            automation.consecutive_failures = 0
            automation.last_status = RunStatus.SUCCEEDED
            return True
        if task.status == TaskStatus.CANCELLED.value:
            # Cancelled by a person: recorded, but not an automation malfunction.
            run.error = "task_cancelled"
            await _record_failure(session, automation, run, run.error, count=False)
            return True
        run.error = (task.failure_code or f"task_{task.status}")[:200]
        await _record_failure(session, automation, run, run.error)
        return True


# ============================================================================ API use-cases
async def _get_owned(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID, *,
                     lock: bool = False) -> Automation:
    stmt = select(Automation).where(Automation.id == automation_id, Automation.tenant_id == ctx.tenant_id)
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    automation = (await session.execute(stmt)).scalar_one_or_none()
    if automation is None or automation.deleted_at is not None or automation.user_id != ctx.user_id:
        raise NotFound("Automation not found")
    return automation


async def get_automation(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID) -> Automation:
    return await _get_owned(session, ctx, automation_id)


async def list_automations(session: AsyncSession, ctx: RequestContext, *, cursor: str | None,
                           limit: int | None) -> Page[AutomationOut]:
    """The caller's own automations, newest first."""
    lim = clamp_limit(limit)
    stmt = select(Automation).where(Automation.tenant_id == ctx.tenant_id, Automation.user_id == ctx.user_id,
                                    Automation.deleted_at.is_(None))
    rows = list((await session.execute(apply_keyset(stmt, Automation, cursor, lim))).scalars().all())
    return build_page(rows, lim, AutomationOut.model_validate)


async def list_runs(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID, *,
                    cursor: str | None, limit: int | None) -> Page[AutomationRunOut]:
    await _get_owned(session, ctx, automation_id)
    lim = clamp_limit(limit)
    stmt = select(AutomationRun).where(AutomationRun.automation_id == automation_id)
    rows = list((await session.execute(apply_keyset(stmt, AutomationRun, cursor, lim))).scalars().all())
    return build_page(rows, lim, AutomationRunOut.model_validate)


async def _validate_template(session: AsyncSession, template: TaskTemplate) -> None:
    if template.agent_id is not None:
        from app.agents.service import resolve_agent

        await resolve_agent(session, template.agent_id)


async def create_automation(session: AsyncSession, ctx: RequestContext, body: AutomationCreate) -> Automation:
    """Create (and commit) an automation owned by the caller, within the plan's limit."""
    from app.billing.service import get_entitlements

    ctx.require(P.AUTOMATIONS_MANAGE, P.TASKS_CREATE)
    # Serialize creations per tenant so concurrent requests cannot overshoot the plan limit
    # (FOR NO KEY UPDATE: does not block foreign-key inserts that reference the organization).
    await session.execute(select(Organization.id).where(Organization.id == ctx.tenant_id)
                          .with_for_update(key_share=True))
    entitlements = await get_entitlements(session, ctx.tenant_id)
    existing = int((await session.execute(
        select(func.count()).select_from(Automation).where(Automation.tenant_id == ctx.tenant_id,
                                                           Automation.deleted_at.is_(None))
    )).scalar_one())
    limit = entitlements.plan.max_automations
    if existing >= limit:
        raise QuotaExceeded(f"Your plan allows {limit} automations.", code="automation_limit_reached",
                            details={"limit": limit, "plan": entitlements.plan.name})
    await _validate_template(session, body.task_template)
    now = utcnow()
    automation = Automation(
        tenant_id=ctx.tenant_id, user_id=ctx.user_id, name=body.name.strip(), trigger_type=body.trigger_type,
        cron_expression=body.cron_expression, timezone=body.timezone,
        task_template=body.task_template.model_dump(mode="json", exclude_none=True), enabled=body.enabled,
        max_runs=body.max_runs, run_count=0, retry_policy=body.retry_policy.model_dump(mode="json"),
        policy=body.policy.model_dump(mode="json"), consecutive_failures=0,
        next_run_at=next_run_from(body.cron_expression, body.timezone, now=now) if body.enabled else None,
    )
    session.add(automation)
    await session.flush()
    audit.record(session, ctx=ctx, category=AuditCategory.AUTOMATION, action="automation.create",
                 resource_type="automation", resource_id=automation.id,
                 metadata={"cron_expression": automation.cron_expression, "timezone": automation.timezone,
                           "enabled": automation.enabled, "max_runs": automation.max_runs})
    await session.commit()
    return automation


async def update_automation(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID,
                            body: AutomationUpdate) -> Automation:
    ctx.require(P.AUTOMATIONS_MANAGE)
    automation = await _get_owned(session, ctx, automation_id, lock=True)
    if body.expected_version is not None and body.expected_version != automation.version:
        raise Conflict("The automation was modified concurrently; reload and retry.", code="version_conflict",
                       details={"current_version": automation.version})
    changes = body.model_dump(exclude_unset=True, exclude={"expected_version"}, mode="json")
    if body.task_template is not None:
        await _validate_template(session, body.task_template)
        changes["task_template"] = body.task_template.model_dump(mode="json", exclude_none=True)
    was_enabled = automation.enabled
    schedule_changed = False
    for key, value in changes.items():
        if key in ("cron_expression", "timezone") and getattr(automation, key) != value:
            schedule_changed = True
        setattr(automation, key, value)
    exhausted = automation.max_runs is not None and automation.run_count >= automation.max_runs
    if automation.enabled and exhausted:
        if changes.get("enabled") is True and not was_enabled:
            raise Conflict("The automation already reached max_runs; raise max_runs to re-enable it.",
                           code="max_runs_reached")
        _disable(automation, REASON_MAX_RUNS)
    elif automation.enabled:
        if not was_enabled:
            ctx.require(P.TASKS_CREATE)
            automation.consecutive_failures = 0
            automation.disabled_reason = None
        if schedule_changed or not was_enabled or automation.next_run_at is None:
            automation.next_run_at = next_run_from(automation.cron_expression, automation.timezone,
                                                   now=utcnow())
    else:
        automation.next_run_at = None
        if was_enabled:
            automation.disabled_reason = None  # disabled by the owner
    audit.record(session, ctx=ctx, category=AuditCategory.AUTOMATION, action="automation.update",
                 resource_type="automation", resource_id=automation.id,
                 metadata={"fields": sorted(changes), "enabled": automation.enabled})
    await session.commit()
    return automation


async def delete_automation(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID) -> None:
    ctx.require(P.AUTOMATIONS_MANAGE)
    automation = await _get_owned(session, ctx, automation_id, lock=True)
    automation.deleted_at = utcnow()
    _disable(automation, None)
    audit.record(session, ctx=ctx, category=AuditCategory.AUTOMATION, action="automation.delete",
                 resource_type="automation", resource_id=automation.id)
    await session.commit()


async def run_now(session: AsyncSession, ctx: RequestContext, automation_id: uuid.UUID, *,
                  now: datetime | None = None) -> tuple[AutomationRun, bool]:
    """Trigger a manual run. Idempotent per automation and minute: repeated calls within the
    same minute return the same run. Returns (run, created). Commits."""
    ctx.require(P.AUTOMATIONS_MANAGE, P.TASKS_CREATE)
    now = ensure_aware(now or utcnow())
    automation = await _get_owned(session, ctx, automation_id, lock=True)
    slot = now.replace(second=0, microsecond=0)
    run = await _insert_run(session, automation, slot, "manual", now)
    if run is None:
        existing = (await session.execute(select(AutomationRun).where(
            AutomationRun.automation_id == automation.id, AutomationRun.scheduled_for == slot))).scalar_one()
        await session.commit()  # nothing written; releases the row lock without expiring objects
        return existing, False
    await _attempt(session, automation, run, now, ctx=ctx)
    audit.record(session, ctx=ctx, category=AuditCategory.AUTOMATION, action="automation.run_now",
                 resource_type="automation", resource_id=automation.id,
                 metadata={"run_id": str(run.id), "status": run.status, "error": run.error})
    await session.commit()
    return run, True


# ============================================================================ account deletion
async def purge_user_automations(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> int:
    """Right-to-delete: hard-delete a user's automations (runs cascade) in one tenant. No commit."""
    result = await session.execute(
        delete(Automation).where(Automation.tenant_id == tenant_id, Automation.user_id == user_id)
        .execution_options(synchronize_session=False))
    return int(result.rowcount or 0)  # type: ignore[attr-defined]
