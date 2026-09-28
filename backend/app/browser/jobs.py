"""``browser.run`` job: BrowserTask → isolated context → execute → observe → persist → report.

Transactions are short and never span browser I/O:

1. lock the BrowserTask, mark it running, open a BrowserSession row (commit);
2. run the executor (no transaction);
3. store the outcome, session counters and usage (commit);
4. report through ``app.execution.external.record_external_outcome`` with the step's
   idempotency key, which wakes the execution engine to verify the step.

The handler is idempotent: a job for a finished task only re-reports the stored outcome
(stale reports are ignored by the engine), a task still running elsewhere defers the job,
and a task whose worker died mid-run is re-run only when it has no interactive actions —
otherwise the outcome is reported as ambiguous so the engine reconciles before retrying.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.browser import service
from app.browser.actions import (
    ActionValidationError,
    BrowserAction,
    has_side_effects,
    parse_actions,
    resolve_locator_order,
)
from app.browser.models import BrowserSession, BrowserSessionStatus, BrowserTask, BrowserTaskStatus
from app.browser.policy import BrowserEgressPolicy, build_browser_policy
from app.browser.schemas import BrowserRunRequest, BrowserRunResult, Expectations
from app.common.enums import ErrorClass
from app.common.time import ensure_aware, utcnow
from app.core import metrics
from app.core.config import Settings, get_settings
from app.core.database import set_tenant_scope
from app.core.exceptions import NotFound
from app.usage.models import UsageKind
from app.usage.service import add_usage
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import DeferJob, PermanentJobFailure

if TYPE_CHECKING:
    from app.browser.executor import BrowserExecutor

logger = logging.getLogger(__name__)

# A running task is presumed alive until its own time limit plus this grace has passed.
STALE_GRACE_SECONDS = 60
# Executor watchdog on top of the executor's own total timeout.
WATCHDOG_GRACE_SECONDS = 30
# Re-runs of a read-only task after worker crashes before giving up.
MAX_RUNS_PER_TASK = 3

PolicyFactory = Callable[..., BrowserEgressPolicy]


@dataclass(slots=True)
class _Prepared:
    id: uuid.UUID
    tenant_id: uuid.UUID
    task_id: uuid.UUID
    step_id: uuid.UUID
    user_id: uuid.UUID | None
    tool_name: str
    actions: list[BrowserAction]
    options: dict[str, Any]
    timeout_seconds: int
    attempts: int
    session_row_id: uuid.UUID
    policy: BrowserEgressPolicy
    side_effects: bool


class BrowserJobRunner:
    def __init__(self, executor: BrowserExecutor | Any, *, settings: Settings | None = None,
                 policy_factory: PolicyFactory | None = None) -> None:
        self.executor = executor
        self.settings = settings or get_settings()
        self.policy_factory: PolicyFactory = policy_factory or build_browser_policy

    async def handle(self, ctx: JobContext, payload: dict[str, Any]) -> None:
        try:
            browser_task_id = uuid.UUID(str(payload["browser_task_id"]))
            tenant_id = uuid.UUID(str(payload["tenant_id"]))
        except (KeyError, ValueError, TypeError) as exc:
            raise PermanentJobFailure("malformed browser.run payload") from exc
        prepared = await self._prepare(ctx, browser_task_id, tenant_id)
        if prepared is None:
            return
        result = await self._execute(ctx, prepared)
        try:
            owned = await self._persist(ctx, prepared, result)
        except Exception:
            if ctx.is_last_attempt:
                await self._fail_quietly(ctx, prepared, "The browser result could not be stored.")
            raise
        if owned:
            await self._report(ctx.session_factory, tenant_id, browser_task_id)

    # ------------------------------------------------------------------ phases
    async def _prepare(self, ctx: JobContext, browser_task_id: uuid.UUID, tenant_id: uuid.UUID
                       ) -> _Prepared | None:
        report = False
        async with _tenant_session(ctx.session_factory, tenant_id) as s:
            task = await service.get_browser_task(s, browser_task_id, lock=True)
            if task is None:
                await s.commit()
                logger.info("browser task no longer exists", extra={"browser_task_id": str(browser_task_id)})
                return None
            if task.status in (BrowserTaskStatus.SUCCEEDED, BrowserTaskStatus.FAILED):
                await s.commit()
                report = True
            elif task.status == BrowserTaskStatus.CANCELLED:
                await s.commit()
                return None
            elif await _task_cancelled(s, task):
                task.status = BrowserTaskStatus.CANCELLED
                task.completed_at = utcnow()
                task.error_message = "The task was cancelled before the browser ran."
                await service.close_open_sessions(s, task.id, status=BrowserSessionStatus.CLOSED,
                                                  error="task cancelled")
                await s.commit()
                return None
            else:
                prepared, report = await self._start(ctx, s, task)
                await s.commit()
                if prepared is not None:
                    return prepared
        if report:
            await self._report(ctx.session_factory, tenant_id, browser_task_id)
        return None

    async def _start(self, ctx: JobContext, s: AsyncSession, task: BrowserTask) -> tuple[_Prepared | None, bool]:
        """Returns (prepared, report_now)."""
        now = utcnow()
        side_effects = has_side_effects(task.actions or [])
        if task.status == BrowserTaskStatus.RUNNING:
            started = ensure_aware(task.started_at) if task.started_at else None
            alive_until = (started + timedelta(seconds=task.timeout_seconds + STALE_GRACE_SECONDS)
                           if started else now)
            if now < alive_until:
                await s.commit()
                raise DeferJob("browser task is still running on another worker",
                               delay_seconds=min(30.0, max(2.0, (alive_until - now).total_seconds())))
            await service.close_open_sessions(s, task.id, status=BrowserSessionStatus.CRASHED,
                                              error="the worker stopped during the run")
            if side_effects:
                service.fail_task(task, ErrorClass.UNKNOWN_OUTCOME,
                                  "The browser worker stopped while running interactive actions; "
                                  "whether they took effect is unknown.")
                return None, True
            if task.attempts >= MAX_RUNS_PER_TASK or ctx.is_last_attempt:
                service.fail_task(task, ErrorClass.TOOL_UNAVAILABLE,
                                  "The browser worker stopped repeatedly while running this task.")
                return None, True
        try:
            actions = parse_actions(task.actions, max_actions=self.settings.browser_max_actions)
        except ActionValidationError as exc:
            service.fail_task(task, ErrorClass.INVALID_INPUT, str(exc))
            return None, True
        from app.organizations.service import get_policy

        org_policy, _ = await get_policy(s, task.tenant_id)
        policy = self.policy_factory(self.settings, org_allowed=org_policy.browser_allowed_domains,
                                     org_denied=org_policy.browser_denied_domains)
        row = service.mark_running(s, task, worker_id=ctx.worker_id, now=now)
        await s.flush()
        return _Prepared(
            id=task.id, tenant_id=task.tenant_id, task_id=task.task_id, step_id=task.step_id, user_id=task.user_id,
            tool_name=task.tool_name, actions=actions, options=dict(task.options or {}),
            timeout_seconds=task.timeout_seconds, attempts=task.attempts, session_row_id=row.id, policy=policy,
            side_effects=side_effects,
        ), False

    async def _execute(self, ctx: JobContext, prepared: _Prepared) -> BrowserRunResult:
        options = prepared.options
        try:
            expectations = Expectations.model_validate(options.get("expect") or {})
        except ValueError:
            expectations = Expectations()
        request = BrowserRunRequest(
            browser_task_id=prepared.id, tenant_id=prepared.tenant_id, actions=prepared.actions,
            policy=prepared.policy, locator_order=resolve_locator_order(options.get("locator_order")),
            timeout_seconds=prepared.timeout_seconds, expectations=expectations,
            on_active=lambda: self._mark_active(ctx.session_factory, prepared),
        )
        try:
            return await asyncio.wait_for(self.executor.run(request),
                                          timeout=prepared.timeout_seconds + WATCHDOG_GRACE_SECONDS)
        except TimeoutError:
            logger.error("browser executor watchdog fired", extra={"browser_task_id": str(prepared.id)})
            return BrowserRunResult.failure("worker_timeout", "The browser did not finish in time.", ErrorClass.TIMEOUT,
                                            crashed=True, side_effect_started=prepared.side_effects)
        except Exception:
            logger.exception("browser executor failed", extra={"browser_task_id": str(prepared.id)})
            return BrowserRunResult.failure("browser_error", "The browser failed unexpectedly.",
                                            ErrorClass.TOOL_UNAVAILABLE, crashed=True,
                                            side_effect_started=prepared.side_effects)

    async def _mark_active(self, session_factory: async_sessionmaker[AsyncSession], prepared: _Prepared) -> None:
        async with _tenant_session(session_factory, prepared.tenant_id) as s:
            await service.mark_session_active(s, prepared.session_row_id)
            await s.commit()

    async def _persist(self, ctx: JobContext, prepared: _Prepared, result: BrowserRunResult) -> bool:
        """Store the outcome. Returns False if this run no longer owns the task."""
        async with _tenant_session(ctx.session_factory, prepared.tenant_id) as s:
            task = await service.get_browser_task(s, prepared.id, lock=True)
            if task is None or task.status != BrowserTaskStatus.RUNNING or task.attempts != prepared.attempts:
                await s.commit()
                return False
            row = await s.get(BrowserSession, prepared.session_row_id)
            error_class, message = self._outcome(prepared, result)
            service.record_run(task, row, result, error_class=error_class, error_message=message)
            seconds = round(result.duration_ms / 1000, 3)
            common: dict[str, Any] = {"tenant_id": prepared.tenant_id, "user_id": prepared.user_id,
                                      "task_id": prepared.task_id,
                                      "metadata": {"browser_task_id": str(prepared.id), "tool": prepared.tool_name}}
            if seconds > 0:
                add_usage(s, kind=UsageKind.BROWSER_SECONDS, quantity=seconds, unit="seconds", **common)
            if result.actions_executed:
                add_usage(s, kind=UsageKind.BROWSER_ACTION, quantity=float(result.actions_executed), **common)
            if prepared.side_effects:
                audit.record(s, category=AuditCategory.TOOL, action="browser.task.finished",
                             status="success" if error_class is None else "failure",
                             tenant_id=prepared.tenant_id, user_id=prepared.user_id, actor_type="worker",
                             task_id=prepared.task_id, step_id=prepared.step_id, tool_name=prepared.tool_name,
                             resource_type="browser_task", resource_id=prepared.id,
                             result_summary=service.summarize(task),
                             metadata={"actions_executed": result.actions_executed,
                                       "error_class": error_class.value if error_class else None,
                                       "blocked_requests": result.blocked_total})
            await s.commit()
        metrics.browser_task_latency.observe(result.duration_ms / 1000)
        return True

    def _outcome(self, prepared: _Prepared, result: BrowserRunResult) -> tuple[ErrorClass | None, str | None]:
        if result.ok:
            return None, None
        message = result.error_message or "The browser task failed."
        if prepared.side_effects and (result.side_effect_started or result.crashed):
            return ErrorClass.UNKNOWN_OUTCOME, f"{message} Interactive actions may already have taken effect."
        error_class = result.error_class or ErrorClass.UNKNOWN
        attempt = int(prepared.options.get("step_attempt") or 1)
        max_attempts = int(prepared.options.get("max_step_attempts") or 1)
        if error_class.retryable and attempt >= max_attempts:
            # The external-outcome path schedules a retry for any retryable class; stop at the tool's limit.
            return ErrorClass.UNKNOWN, f"{message} (retries exhausted)"
        return error_class, message

    async def _report(self, session_factory: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID,
                      browser_task_id: uuid.UUID) -> None:
        from app.execution.external import record_external_outcome

        async with _tenant_session(session_factory, tenant_id) as s:
            task = await service.get_browser_task(s, browser_task_id)
            if task is None or task.status not in (BrowserTaskStatus.SUCCEEDED, BrowserTaskStatus.FAILED):
                await s.commit()
                return
            actions = float((task.result or {}).get("actions_executed") or 0)
            try:
                if task.status == BrowserTaskStatus.SUCCEEDED:
                    delivered = await record_external_outcome(
                        s, task_id=task.task_id, step_id=task.step_id, idempotency_key=task.idempotency_key,
                        output=task.result or {"browser_task_id": str(task.id)}, summary=service.summarize(task),
                        external_ref=str(task.id), usage={"browser_actions": actions})
                else:
                    error_class = _error_class(task.error_class)
                    delivered = await record_external_outcome(
                        s, task_id=task.task_id, step_id=task.step_id, idempotency_key=task.idempotency_key,
                        output=None, summary=service.summarize(task), error_class=error_class,
                        error_message=task.error_message, external_ref=str(task.id),
                        ambiguous=error_class == ErrorClass.UNKNOWN_OUTCOME, usage={"browser_actions": actions})
            except NotFound:
                await s.rollback()
                logger.info("browser task's step no longer exists", extra={"browser_task_id": str(task.id)})
                return
        if not delivered:
            logger.info("browser outcome not delivered (step no longer waiting)",
                        extra={"browser_task_id": str(browser_task_id)})

    async def _fail_quietly(self, ctx: JobContext, prepared: _Prepared, message: str) -> None:
        """Last job attempt: make sure the step does not wait forever."""
        try:
            async with _tenant_session(ctx.session_factory, prepared.tenant_id) as s:
                task = await service.get_browser_task(s, prepared.id, lock=True)
                if task is not None and task.status == BrowserTaskStatus.RUNNING:
                    cls = ErrorClass.UNKNOWN_OUTCOME if prepared.side_effects else ErrorClass.UNKNOWN
                    service.fail_task(task, cls, message)
                    await service.close_open_sessions(s, task.id, status=BrowserSessionStatus.CRASHED, error=message)
                await s.commit()
            await self._report(ctx.session_factory, prepared.tenant_id, prepared.id)
        except Exception:
            logger.exception("could not record browser failure", extra={"browser_task_id": str(prepared.id)})


def _error_class(value: str | None) -> ErrorClass:
    try:
        return ErrorClass(value or ErrorClass.UNKNOWN.value)
    except ValueError:
        return ErrorClass.UNKNOWN


async def _task_cancelled(s: AsyncSession, task: BrowserTask) -> bool:
    from app.tasks import repository as task_repo

    try:
        owner = await task_repo.get_task(s, task.task_id)
    except NotFound:
        return True
    return owner.cancel_requested_at is not None or owner.status in ("cancelled", "cancel_requested")


@contextlib.asynccontextmanager
async def _tenant_session(session_factory: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID
                          ) -> AsyncIterator[AsyncSession]:
    async with session_factory() as session:
        set_tenant_scope(session, tenant_id)
        yield session


# ---------------------------------------------------------------------------- process singleton
_runner: BrowserJobRunner | None = None


def get_browser_job_runner() -> BrowserJobRunner:
    global _runner
    if _runner is None:
        from app.browser.executor import BrowserExecutor
        from app.files.storage import build_storage

        settings = get_settings()
        _runner = BrowserJobRunner(BrowserExecutor(settings, build_storage(settings)), settings=settings)
    return _runner


def set_browser_job_runner(runner: BrowserJobRunner | None) -> None:
    global _runner
    _runner = runner


@job(service.JOB_TYPE)
async def run_browser_task(ctx: JobContext, payload: dict[str, Any]) -> None:
    await get_browser_job_runner().handle(ctx, payload)
