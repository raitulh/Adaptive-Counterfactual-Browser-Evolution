"""Durable, deterministic execution engine.

    Task → load state → resolve next executable steps → evaluate policy → run step
         → persist result → verify → transition → continue

Guarantees:
* **Single driver.** A task is driven by at most one worker at a time (DB lease,
  renewed while work is in flight). Row locks (task → step → approval) guard
  every state transition; transitions are validated by ``app.tasks.state``.
* **No transaction spans I/O.** Intent is committed before any external call,
  the outcome after it.
* **Backend decides.** Arguments are resolved deterministically, validated
  against the tool schema, and the permission engine is re-run at execution
  time with the *concrete* arguments. Approvals are re-checked, bound to the
  exact action hash and consumed exactly once.
* **No false completion.** Side-effecting calls go through an idempotency ledger
  (``external_actions``). Unknown outcomes (timeouts, crashes) are reconciled
  against the provider before any retry; a step completes only after its
  verifier produces machine-readable PASSED evidence; the task completes only
  after a final check that every step is verified and no action is unresolved.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.acbe.runtime import ActiveStrategy, resolve_strategy
from app.agents.schemas import ResolvedAgent
from app.agents.service import resolve_agent
from app.approvals import service as approvals
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.enums import ErrorClass, PermissionLevel, TrustLevel, VerificationStatus
from app.common.events import EventType
from app.common.sanitize import bound_structure, clean_text
from app.common.time import ensure_aware, utcnow
from app.core import metrics
from app.core.config import Settings, get_settings
from app.core.exceptions import AppError, ToolInputInvalid, ToolNotFound
from app.core.logging import log_context
from app.core.telemetry import span
from app.execution.references import UnresolvableReference, collect_refs, resolve
from app.execution.summary import build_summary
from app.notifications.service import NotificationEvent, notify
from app.organizations import repository as org_repo
from app.permissions.service import Decision, PermissionService, PolicyInputs, load_policy_inputs
from app.recovery.models import FailureRecord, RecoveryAttempt
from app.recovery.service import (
    ClassifiedFailure,
    FailureClassifier,
    RecoveryAction,
    RecoveryDecision,
    RecoveryPlanner,
    is_definitive_before_effect,
)
from app.tasks import repository as task_repo
from app.tasks.models import ExecutionLog, ExternalAction, Task, TaskAttempt, TaskStep
from app.tasks.state import (
    STEP_TERMINAL,
    StepStatus,
    TaskStatus,
    append_event,
    transition_step,
    transition_task,
)
from app.tools.base import (
    ReconcileStatus,
    RetryPolicy,
    Tool,
    ToolContext,
    ToolResult,
    canonical_hash,
)
from app.tools.registry import ToolResolver
from app.tools.services import ToolServices
from app.usage.models import UsageKind
from app.usage.service import add_usage, record_usage_once
from app.users.models import User
from app.verification.models import VerificationResult
from app.verification.types import Difference, VerificationMethod, VerificationOutcome
from app.workers.queues.base import DeferJob, JobSpec, Queues

logger = logging.getLogger(__name__)

MAX_ITERATIONS = 200
MAX_PARALLEL = 4
MAX_OUTPUT_JSON_ITEMS = 200
MAX_ARGUMENT_BYTES = 1_000_000
RECON_UNKNOWN = "reconciliation_unknown"
VERIFY_INCONCLUSIVE = "verification_inconclusive"
AWAITING_USER_CODES = (RECON_UNKNOWN, VERIFY_INCONCLUSIVE, "verification_mismatch")


@dataclass(slots=True)
class RunContext:
    """Per-run cache of things that do not change while the engine drives a task."""

    task_id: uuid.UUID
    tenant_id: uuid.UUID
    principal: RequestContext
    agent: ResolvedAgent
    policy: PolicyInputs
    strategy: ActiveStrategy
    timezone: str


@dataclass(slots=True)
class Iteration:
    stop: bool = False
    ready: list[uuid.UUID] = field(default_factory=list)
    verify: list[uuid.UUID] = field(default_factory=list)
    reconcile: list[uuid.UUID] = field(default_factory=list)


@dataclass(slots=True)
class StartedStep:
    step_id: uuid.UUID
    attempt_id: uuid.UUID | None
    tool: Tool[Any, Any]
    args: Any
    tctx: ToolContext
    tainted: bool
    reuse: ToolResult | None = None  # ledger already recorded success


class ExecutionEngine:
    def __init__(self, *, services: ToolServices, session_factory: async_sessionmaker[AsyncSession], queue: Any,
                 worker_id: str, resolver: ToolResolver | None = None,
                 permissions: PermissionService | None = None, settings: Settings | None = None) -> None:
        self.services = services
        self.sf = session_factory
        self.queue = queue
        self.worker_id = worker_id
        self.resolver = resolver or ToolResolver()
        self.permissions = permissions or PermissionService()
        self.classifier = FailureClassifier()
        self.recovery = RecoveryPlanner()
        self.settings = settings or get_settings()
        self.lease_seconds = max(30, self.settings.job_lease_seconds)

    # ------------------------------------------------------------------ plumbing
    @contextlib.asynccontextmanager
    async def _session(self, tenant_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
        async with self.sf() as session:
            session.info["tenant_id"] = tenant_id
            try:
                yield session
            finally:
                if session.in_transaction():
                    await session.rollback()

    async def _acquire_lease(self, tenant_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        async with self._session(tenant_id) as s:
            now = utcnow()
            result = await s.execute(
                update(Task).where(Task.id == task_id, or_(Task.lease_owner.is_(None), Task.lease_expires_at < now,
                                                           Task.lease_owner == self.worker_id))
                .values(lease_owner=self.worker_id, lease_expires_at=now + timedelta(seconds=self.lease_seconds),
                        version=Task.version + 1)
                .execution_options(synchronize_session=False))
            await s.commit()
            return bool(result.rowcount)  # type: ignore[attr-defined]

    async def _renew_lease(self, tenant_id: uuid.UUID, task_id: uuid.UUID) -> bool:
        async with self._session(tenant_id) as s:
            result = await s.execute(
                update(Task).where(Task.id == task_id, Task.lease_owner == self.worker_id)
                .values(lease_expires_at=utcnow() + timedelta(seconds=self.lease_seconds))
                .execution_options(synchronize_session=False))
            await s.commit()
            return bool(result.rowcount)  # type: ignore[attr-defined]

    async def _release_lease(self, tenant_id: uuid.UUID, task_id: uuid.UUID) -> None:
        async with self._session(tenant_id) as s:
            await s.execute(update(Task).where(Task.id == task_id, Task.lease_owner == self.worker_id)
                            .values(lease_owner=None, lease_expires_at=None)
                            .execution_options(synchronize_session=False))
            await s.commit()

    async def _lease_keeper(self, tenant_id: uuid.UUID, task_id: uuid.UUID, lost: asyncio.Event) -> None:
        interval = max(5.0, self.lease_seconds / 3)
        while True:
            await asyncio.sleep(interval)
            try:
                if not await self._renew_lease(tenant_id, task_id):
                    lost.set()
                    return
            except Exception:  # transient DB error: try again next tick
                logger.warning("lease renewal failed", extra={"task_id": str(task_id)})

    async def _enqueue_execute(self, session: AsyncSession, task: Task, *, delay_seconds: float = 0.0) -> None:
        await self.queue.enqueue(session, JobSpec(
            queue=Queues.EXECUTION, job_type="task.execute",
            payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
            dedupe_key=f"task:{task.id}", tenant_id=task.tenant_id, priority=task.priority,
            delay_seconds=delay_seconds))

    # ------------------------------------------------------------------ entry point
    async def run(self, task_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
        with log_context(task_id=task_id, tenant_id=tenant_id), span("task.execute", **{"task.id": task_id}):
            if not await self._acquire_lease(tenant_id, task_id):
                raise DeferJob("task is being driven by another worker", delay_seconds=3)
            lost = asyncio.Event()
            keeper = asyncio.create_task(self._lease_keeper(tenant_id, task_id, lost))
            try:
                rc = await self._load_run_context(tenant_id, task_id)
                if rc is None:
                    return "stopped"
                for _ in range(MAX_ITERATIONS):
                    if lost.is_set():
                        logger.warning("task lease lost; stopping", extra={"task_id": str(task_id)})
                        return "lease_lost"
                    it = await self._prepare_iteration(rc)
                    if it.stop:
                        return "stopped"
                    if it.verify:
                        await asyncio.gather(*(self._verify_step(rc, sid) for sid in it.verify))
                        continue
                    if it.reconcile:
                        for sid in it.reconcile:
                            await self._reconcile_step(rc, sid)
                        continue
                    if it.ready:
                        await asyncio.gather(*(self._run_step(rc, sid) for sid in it.ready))
                        continue
                    return await self._settle(rc)
                logger.error("iteration bound reached", extra={"task_id": str(task_id)})
                return "iteration_bound"
            finally:
                keeper.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await keeper
                await self._release_lease(tenant_id, task_id)

    async def _load_run_context(self, tenant_id: uuid.UUID, task_id: uuid.UUID) -> RunContext | None:
        async with self._session(tenant_id) as s:
            task = await task_repo.get_task(s, task_id)
            principal = await self._principal(s, task)
            if principal is None:
                task = await task_repo.lock_task(s, task_id)
                if TaskStatus(task.status) not in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED):
                    task.failure_code, task.failure_message = "principal_revoked", \
                        "The task owner no longer has access to this organization."
                    await self._force_status(s, task, TaskStatus.FAILED, "owner access revoked")
                    await s.commit()
                return None
            agent = await resolve_agent(s, task.agent_id, task.agent_version_id)
            policy = await load_policy_inputs(s, tenant_id, agent.tool_policy)
            strategy = await resolve_strategy(s, tenant_id, task.id)
            return RunContext(task_id=task_id, tenant_id=tenant_id, principal=principal, agent=agent, policy=policy,
                              strategy=strategy, timezone=principal.timezone)

    async def _principal(self, s: AsyncSession, task: Task) -> RequestContext | None:
        """Permissions are re-derived from the owner's *current* membership on every run."""
        user = await s.get(User, task.user_id)
        if user is None or user.status != "active" or user.deleted_at is not None:
            return None
        membership = await org_repo.get_active_membership(s, user.id, task.tenant_id)
        if membership is None:
            return None
        _, role, _ = membership
        perms = await org_repo.role_permissions(s, role.id)
        return RequestContext(user_id=user.id, tenant_id=task.tenant_id, role=role.name, permissions=perms,
                              timezone=user.timezone, email=user.email, actor_type="worker")

    async def _force_status(self, s: AsyncSession, task: Task, target: TaskStatus, reason: str) -> None:
        """Move a task to a terminal/resting state through legal intermediate states."""
        current = TaskStatus(task.status)
        if current == target:
            return
        from app.tasks.state import TASK_TRANSITIONS

        if target not in TASK_TRANSITIONS[current] and TaskStatus.RUNNING in TASK_TRANSITIONS[current]:
            await transition_task(s, task, TaskStatus.RUNNING, reason=reason)
        await transition_task(s, task, target, reason=reason)

    # ------------------------------------------------------------------ iteration
    async def _prepare_iteration(self, rc: RunContext) -> Iteration:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            status = TaskStatus(task.status)
            if status in (TaskStatus.COMPLETED, TaskStatus.CANCELLED):
                await s.commit()
                return Iteration(stop=True)
            if status == TaskStatus.CANCEL_REQUESTED or task.cancel_requested_at is not None:
                await self._finalize_cancel(s, task)
                await s.commit()
                return Iteration(stop=True)
            if task.pause_requested_at is not None and status in (TaskStatus.QUEUED, TaskStatus.RUNNING):
                task.pause_requested_at = None
                await transition_task(s, task, TaskStatus.PAUSED, reason="pause requested")
                await s.commit()
                return Iteration(stop=True)
            if status not in (TaskStatus.QUEUED, TaskStatus.RUNNING, TaskStatus.RECOVERING, TaskStatus.VERIFYING):
                await s.commit()
                return Iteration(stop=True)
            if status != TaskStatus.RUNNING:
                await transition_task(s, task, TaskStatus.RUNNING, reason="execution started")
            # Budgets that apply regardless of the next step.
            if task.deadline_at is not None and ensure_aware(task.deadline_at) < utcnow():
                await self._fail_task(s, task, "deadline_exceeded", "The task exceeded its maximum duration.")
                await s.commit()
                return Iteration(stop=True)
            max_cost = float(task.budget.get("max_cost_usd", self.settings.max_task_cost_usd))
            if task.cost_micros > max_cost * 1_000_000:
                await self._fail_task(s, task, "budget_exceeded", "The task exceeded its cost budget.")
                await s.commit()
                return Iteration(stop=True)

            steps = await task_repo.current_steps(s, task, lock=True)
            by_key = {st.step_key: st for st in steps}
            it = Iteration()
            now = utcnow()
            for st in steps:
                state = StepStatus(st.status)
                if state == StepStatus.RUNNING:
                    # We hold the lease and nothing of ours is in flight: a previous worker died mid-call.
                    await self._handle_orphan(s, task, st)
                    state = StepStatus(st.status)
                if state == StepStatus.VERIFYING:
                    it.verify.append(st.id)
                elif state == StepStatus.REQUIRES_RECONCILIATION and st.error_code not in AWAITING_USER_CODES:
                    it.reconcile.append(st.id)
            # Cascade: steps whose dependencies can no longer complete are skipped.
            changed = True
            while changed:
                changed = False
                for st in steps:
                    if st.status != StepStatus.PENDING.value:
                        continue
                    deps = self._dependency_keys(task, st)
                    if any(by_key[d].status in (StepStatus.FAILED.value, StepStatus.SKIPPED.value,
                                                StepStatus.CANCELLED.value) for d in deps if d in by_key):
                        transition_step(st, StepStatus.SKIPPED)
                        st.error_message = "Skipped because a step it depends on did not complete."
                        await append_event(s, task, EventType.STEP_SKIPPED, step_id=st.id,
                                           payload={"step": st.step_key})
                        changed = True
            if not it.verify and not it.reconcile:
                ready: list[TaskStep] = []
                for st in steps:
                    runnable = st.status == StepStatus.PENDING.value or (
                        st.status == StepStatus.RETRY_SCHEDULED.value
                        and (st.next_attempt_at is None or ensure_aware(st.next_attempt_at) <= now))
                    if not runnable:
                        continue
                    deps = self._dependency_keys(task, st)
                    if all(d in by_key and by_key[d].status == StepStatus.COMPLETED.value for d in deps):
                        ready.append(st)
                it.ready = await self._batch(s, rc, ready)
            await s.commit()
            return it

    def _dependency_keys(self, task: Task, step: TaskStep) -> set[str]:
        deps = set((task.plan or {}).get("dependencies", {}).get(step.step_key, []))
        with contextlib.suppress(UnresolvableReference):
            deps |= collect_refs(step.arguments)
        return deps

    async def _batch(self, s: AsyncSession, rc: RunContext, ready: list[TaskStep]) -> list[uuid.UUID]:
        """Independent read-only steps run concurrently; side-effecting steps run one at a time."""
        if not ready:
            return []
        safe: list[uuid.UUID] = []
        for st in ready:
            try:
                tool = await self.resolver.resolve(s, rc.tenant_id, st.tool_name, st.tool_version)
            except ToolNotFound:
                return [st.id]  # let _run_step fail it with a proper error
            if tool.spec.parallel_safe and not tool.spec.has_side_effects:
                safe.append(st.id)
            elif not safe:
                return [st.id]
        return safe[:MAX_PARALLEL]

    async def _handle_orphan(self, s: AsyncSession, task: Task, step: TaskStep) -> None:
        attempt = (await s.execute(select(TaskAttempt).where(TaskAttempt.step_id == step.id)
                                   .order_by(TaskAttempt.attempt_number.desc()).limit(1))).scalar_one_or_none()
        if attempt is not None and attempt.status == "started":
            attempt.status = "abandoned"
            attempt.finished_at = utcnow()
            attempt.error_message = "worker stopped before recording the outcome"
        try:
            tool = await self.resolver.resolve(s, task.tenant_id, step.tool_name, step.tool_version)
            side_effects = tool.spec.has_side_effects
        except ToolNotFound:
            side_effects = True
        if side_effects:
            transition_step(step, StepStatus.REQUIRES_RECONCILIATION)
            step.error_class, step.error_code = ErrorClass.UNKNOWN_OUTCOME.value, "worker_interrupted"
            step.error_message = "The worker stopped during this action; checking whether it took effect."
            await append_event(s, task, EventType.RECONCILIATION_REQUIRED, step_id=step.id,
                               payload={"step": step.step_key, "reason": "worker_interrupted"})
        else:
            transition_step(step, StepStatus.PENDING)
        self._log(s, task, step, "warning", "Recovered an interrupted step after a worker restart.")

    # ------------------------------------------------------------------ step execution
    def _tool_context(self, rc: RunContext, task: Task, step: TaskStep, idempotency_key: str,
                      attempt_number: int) -> ToolContext:
        return ToolContext(ctx=rc.principal, task_id=task.id, step_id=step.id, step_key=step.step_key,
                           attempt_number=attempt_number, idempotency_key=idempotency_key, services=self.services,
                           org_policy=rc.policy.org_policy, timezone=rc.timezone,
                           strategy=rc.strategy.config.model_dump())

    def _retry_policy(self, rc: RunContext, tool: Tool[Any, Any], step: TaskStep) -> RetryPolicy:
        policy = tool.spec.retry_policy
        tuned = rc.strategy.config.tool_retry.get(tool.spec.name)
        if tuned is not None and tool.spec.permission_level not in (PermissionLevel.DESTRUCTIVE,
                                                                    PermissionLevel.FINANCIAL):
            policy = policy.model_copy(update={"max_attempts": tuned.max_attempts,
                                               "base_delay_seconds": tuned.base_delay_seconds})
        plan_max = int((step.retry_policy or {}).get("max_attempts", policy.max_attempts))
        return policy.model_copy(update={"max_attempts": max(1, min(policy.max_attempts, plan_max))})

    async def _tainted(self, s: AsyncSession, task: Task, step: TaskStep) -> bool:
        if (task.execution_metadata or {}).get("planner_saw_untrusted"):
            return True
        try:
            refs = collect_refs(step.arguments)
        except UnresolvableReference:
            return True
        if not refs:
            return False
        rows = (await s.execute(select(TaskStep.output_trust).where(
            TaskStep.task_id == task.id, TaskStep.plan_version == task.plan_version,
            TaskStep.step_key.in_(refs)))).scalars().all()
        return any(r == TrustLevel.UNTRUSTED_EXTERNAL_CONTENT.value for r in rows)

    async def _run_step(self, rc: RunContext, step_id: uuid.UUID) -> None:
        with log_context(step_id=step_id):
            started = await self._begin_step(rc, step_id)
            if started is None:
                return
            if started.reuse is not None:
                await self._verify_step(rc, step_id)
                return
            t0 = time.perf_counter()
            timeout = min(900.0, float(started.tool.spec.timeout_seconds))
            try:
                with span("tool.execute", **{"tool.name": started.tool.spec.name, "task.id": rc.task_id,
                                             "step.id": step_id}):
                    result = await asyncio.wait_for(started.tool.execute(started.tctx, started.args), timeout=timeout)
                    ToolResult.model_validate(result)
            except Exception as exc:  # classified below; nothing escapes unrecorded
                elapsed = time.perf_counter() - t0
                metrics.tool_latency.labels(started.tool.spec.name).observe(elapsed)
                await self._record_failure(rc, started, exc, elapsed)
                return
            elapsed = time.perf_counter() - t0
            metrics.tool_latency.labels(started.tool.spec.name).observe(elapsed)
            proceed = await self._record_success(rc, started, result, elapsed)
            if proceed:
                await self._verify_step(rc, step_id)

    async def _begin_step(self, rc: RunContext, step_id: uuid.UUID) -> StartedStep | None:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, step_id)
            if step.status not in (StepStatus.PENDING.value, StepStatus.RETRY_SCHEDULED.value):
                await s.commit()
                return None
            if task.cancel_requested_at is not None or task.status != TaskStatus.RUNNING.value:
                await s.commit()
                return None
            try:
                tool = await self.resolver.resolve(s, rc.tenant_id, step.tool_name, step.tool_version)
            except ToolNotFound as exc:
                await self._fail_step_now(s, task, step, ErrorClass.TOOL_UNAVAILABLE, exc.code, exc.message)
                await s.commit()
                return None

            # 1. Deterministic argument resolution + full schema validation.
            steps = await task_repo.current_steps(s, task)
            outputs = task_repo.step_outputs_by_key(steps)
            try:
                resolved = resolve(step.arguments, outputs)
                args = tool.parse_args(resolved)
            except (UnresolvableReference, ValidationError, ToolInputInvalid) as exc:
                failure = self.classifier.classify(exc, side_effects=False)
                failure.error_class = ErrorClass.INVALID_INPUT
                await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
                await s.commit()
                return None
            canonical = args.model_dump(mode="json")
            if len(json.dumps(canonical, default=str)) > MAX_ARGUMENT_BYTES:
                failure = ClassifiedFailure(ErrorClass.INVALID_INPUT, "arguments_too_large",
                                            "The step's arguments exceed the allowed size.")
                await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
                await s.commit()
                return None
            action_hash = canonical_hash({"tool": tool.spec.key, "args": canonical})
            side_effects = tool.spec.has_side_effects
            attempt_number = step.attempt_count + 1
            idem = (f"{task.id}:{tool.spec.name}:{action_hash[:32]}" if side_effects
                    else f"{task.id}:{step.id}:{attempt_number}")
            # Stored exactly (not normalised): approvals, verification and audits refer to these values.
            step.resolved_arguments = canonical
            step.resolved_args_hash = action_hash
            step.idempotency_key = idem

            # 2. Permission + policy with the concrete arguments.
            tainted = await self._tainted(s, task, step)
            try:
                assessment = tool.assess(args, rc.policy.org_policy)
            except AppError as exc:
                failure = self.classifier.classify(exc, side_effects=False)
                await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
                await s.commit()
                return None
            model_asked = bool(((task.plan or {}).get("model_labels", {}).get(step.step_key, {}))
                               .get("requires_approval"))
            decision = self.permissions.evaluate(rc.principal, tool.spec, rc.policy, assessment=assessment,
                                                 model_requested_approval=model_asked, tainted_by_untrusted=tainted)
            step.permission_level = decision.permission_level.value
            step.risk_level = decision.risk_level.value
            step.policy_reasons = decision.reasons
            if decision.decision == Decision.DENY:
                audit.record(s, category=AuditCategory.TOOL, action="tool.denied", status="denied",
                             tenant_id=task.tenant_id, user_id=task.user_id, actor_type="worker", task_id=task.id,
                             step_id=step.id, tool_name=tool.spec.name, metadata={"reasons": decision.reasons})
                failure = ClassifiedFailure(ErrorClass.POLICY_BLOCKED, "policy_denied",
                                            "Blocked by policy: " + "; ".join(decision.reasons))
                await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
                await s.commit()
                return None

            # 3. Budgets and per-tool rate limits.
            max_calls = int(task.budget.get("max_tool_calls", self.settings.max_tool_calls_per_task))
            if task.tool_calls >= max_calls:
                await append_event(s, task, EventType.BUDGET_EXCEEDED, step_id=step.id,
                                   payload={"budget": "tool_calls", "limit": max_calls})
                failure = ClassifiedFailure(ErrorClass.POLICY_BLOCKED, "budget_exceeded",
                                            f"The task reached its limit of {max_calls} tool calls.")
                await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
                await s.commit()
                return None
            from app.security.ratelimit import get_rate_limiter

            limit = await get_rate_limiter().hit("tool", f"{task.tenant_id}:{tool.spec.name}",
                                                 self.settings.rate_limit_tool_calls_per_minute)
            if not limit.allowed:
                if step.status == StepStatus.PENDING.value:
                    transition_step(step, StepStatus.RUNNING)
                transition_step(step, StepStatus.RETRY_SCHEDULED)
                step.next_attempt_at = utcnow() + timedelta(seconds=max(1, limit.reset_seconds))
                await s.commit()
                return None

            # 4. Approval: re-checked now, bound to this exact action, consumed once.
            approval_id: uuid.UUID | None = None
            if decision.decision == Decision.REQUIRE_APPROVAL:
                step.requires_approval = True
                valid = await approvals.find_valid_approval(s, step, action_hash)
                if valid is None:
                    target = tool.target(args)
                    await approvals.request_approval(
                        s, task=task, step=step, tool=tool, resolved_args=canonical, action_hash=action_hash,
                        risk_level=decision.risk_level.value, permission_level=decision.permission_level.value,
                        reasons=decision.reasons, summary=tool.describe(args), target=target,
                        ttl_seconds=rc.policy.org_policy.approval_ttl_seconds)
                    transition_step(step, StepStatus.WAITING_APPROVAL)
                    self._log(s, task, step, "info", f"Waiting for your approval: {tool.describe(args)}")
                    await s.commit()
                    return None
                await approvals.consume(s, valid, step=step, action_hash=action_hash)
                approval_id = valid.id

            # 5. Idempotency ledger (intent first).
            tctx = self._tool_context(rc, task, step, idem, attempt_number)
            if side_effects:
                ledger = (await s.execute(select(ExternalAction).where(ExternalAction.idempotency_key == idem)
                                          .with_for_update())).scalar_one_or_none()
                if ledger is not None and ledger.status == "succeeded":
                    reuse = ToolResult(output=ledger.result or {}, external_ref=ledger.external_ref,
                                       summary="Result recorded by an earlier attempt (not re-executed)")
                    transition_step(step, StepStatus.RUNNING)
                    await self._store_output(s, task, step, tool, reuse, tainted)
                    transition_step(step, StepStatus.VERIFYING)
                    await s.commit()
                    return StartedStep(step_id, None, tool, args, tctx, tainted, reuse=reuse)
                if ledger is not None and ledger.status == "pending":
                    transition_step(step, StepStatus.RUNNING)
                    transition_step(step, StepStatus.REQUIRES_RECONCILIATION)
                    step.error_class, step.error_code = ErrorClass.UNKNOWN_OUTCOME.value, "ledger_pending"
                    await s.commit()
                    return None
                if ledger is None:
                    ledger = ExternalAction(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                                            tool_name=tool.spec.name, idempotency_key=idem, request_hash=action_hash)
                    s.add(ledger)
                ledger.status = "pending"
                ledger.attempts += 1
                ledger.approval_request_id = approval_id

            attempt = TaskAttempt(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                                  attempt_number=attempt_number, status="started", idempotency_key=idem,
                                  request_hash=action_hash, worker_id=self.worker_id)
            s.add(attempt)
            step.attempt_count = attempt_number
            step.next_attempt_at = None
            transition_step(step, StepStatus.RUNNING)
            task.tool_calls += 1
            await append_event(s, task, EventType.TOOL_CALL_STARTED, step_id=step.id,
                               payload={"step": step.step_key, "tool": tool.spec.name, "attempt": attempt_number,
                                        "action": tool.describe(args)[:300]})
            self._log(s, task, step, "info", f"Running: {tool.describe(args)[:300]}")
            await s.flush()
            attempt_id = attempt.id
            await s.commit()
            return StartedStep(step_id, attempt_id, tool, args, tctx, tainted)

    async def _store_output(self, s: AsyncSession, task: Task, step: TaskStep, tool: Tool[Any, Any],
                            result: ToolResult, tainted: bool) -> None:
        untrusted = (tool.spec.output_trust == TrustLevel.UNTRUSTED_EXTERNAL_CONTENT
                     or result.trust == TrustLevel.UNTRUSTED_EXTERNAL_CONTENT or tainted)
        step.output = bound_structure(result.output, max_depth=10, max_items=MAX_OUTPUT_JSON_ITEMS,
                                      max_string=40_000)
        step.output_trust = (TrustLevel.UNTRUSTED_EXTERNAL_CONTENT if untrusted
                             else TrustLevel.CONTROLLED_AGENT_OUTPUT).value
        step.output_summary = clean_text(result.summary, max_chars=500)
        step.external_ref = result.external_ref

    async def _record_success(self, rc: RunContext, started: StartedStep, result: ToolResult, elapsed: float
                              ) -> bool:
        tool = started.tool
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, started.step_id)
            attempt = await s.get(TaskAttempt, started.attempt_id) if started.attempt_id else None
            if attempt is not None:
                attempt.status = "succeeded"
                attempt.finished_at = utcnow()
                attempt.duration_ms = int(elapsed * 1000)
                attempt.output_summary = clean_text(result.summary, max_chars=500)
            if tool.spec.has_side_effects:
                ledger = (await s.execute(select(ExternalAction).where(
                    ExternalAction.idempotency_key == step.idempotency_key).with_for_update())).scalar_one_or_none()
                if ledger is not None:
                    ledger.status = "succeeded" if not result.pending_external else "pending"
                    ledger.external_ref = result.external_ref
                    ledger.result = bound_structure(result.output, max_depth=10, max_items=MAX_OUTPUT_JSON_ITEMS)
            await self._store_output(s, task, step, tool, result, started.tainted)
            task.model_calls += int(result.usage.get("model_calls", 0))
            task.cost_micros += int(float(result.usage.get("cost_usd", 0.0)) * 1_000_000)
            if attempt is not None:
                await record_usage_once(s, idempotency_key=f"tool_call:{attempt.id}", tenant_id=task.tenant_id,
                                        kind=UsageKind.TOOL_CALL, user_id=task.user_id, task_id=task.id,
                                        agent_id=task.agent_id, metadata={"tool": tool.spec.name})
            if tool.spec.has_side_effects:
                audit.record(s, category=AuditCategory.TOOL, action="tool.executed", tenant_id=task.tenant_id,
                             user_id=task.user_id, actor_type="worker", task_id=task.id, step_id=step.id,
                             tool_name=tool.spec.name, approval_id=None, resource_type="external_ref",
                             resource_id=result.external_ref, result_summary=result.summary,
                             metadata={"idempotency_key_hash": canonical_hash(step.idempotency_key)[:16]})
            metrics.tool_calls_total.labels(tool.spec.name, "success").inc()
            await append_event(s, task, EventType.TOOL_CALL_FINISHED, step_id=step.id,
                               payload={"step": step.step_key, "tool": tool.spec.name, "summary": step.output_summary,
                                        "duration_ms": int(elapsed * 1000)})
            if result.pending_external:
                transition_step(step, StepStatus.WAITING_EXTERNAL)
                self._log(s, task, step, "info", f"Dispatched to an isolated worker: {step.output_summary}")
                await s.commit()
                return False
            transition_step(step, StepStatus.VERIFYING)
            await s.commit()
            return True

    async def _record_failure(self, rc: RunContext, started: StartedStep, exc: BaseException, elapsed: float
                              ) -> None:
        tool = started.tool
        failure = self.classifier.classify(exc, side_effects=tool.spec.has_side_effects)
        logger.info("tool failed", extra={"tool": tool.spec.name, "error_class": failure.error_class.value,
                                          "code": failure.code})
        metrics.tool_calls_total.labels(tool.spec.name, "failure").inc()
        metrics.tool_error_total.labels(tool.spec.name, failure.error_class.value).inc()
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, started.step_id)
            attempt = await s.get(TaskAttempt, started.attempt_id) if started.attempt_id else None
            if attempt is not None:
                attempt.status = "unknown" if failure.ambiguous_outcome else "failed"
                attempt.finished_at = utcnow()
                attempt.duration_ms = int(elapsed * 1000)
                attempt.error_class = failure.error_class.value
                attempt.error_message = failure.message[:1000]
            if tool.spec.has_side_effects:
                ledger = (await s.execute(select(ExternalAction).where(
                    ExternalAction.idempotency_key == step.idempotency_key).with_for_update())).scalar_one_or_none()
                if ledger is not None and is_definitive_before_effect(failure):
                    ledger.status = "failed"  # provider certainly did not act: a later retry is safe
            await append_event(s, task, EventType.TOOL_CALL_FINISHED, step_id=step.id,
                               payload={"step": step.step_key, "tool": tool.spec.name, "error": failure.code,
                                        "error_class": failure.error_class.value})
            await self._apply_failure(s, rc, task, step, tool, failure, attempt=attempt)
            await s.commit()

    # ------------------------------------------------------------------ failure / recovery
    async def _apply_failure(self, s: AsyncSession, rc: RunContext, task: Task, step: TaskStep, tool: Tool[Any, Any],
                             failure: ClassifiedFailure, *, attempt: TaskAttempt | None) -> RecoveryDecision:
        policy = self._retry_policy(rc, tool, step)
        decision = self.recovery.decide(failure, spec=tool.spec, attempt=step.attempt_count or 1,
                                        max_attempts=policy.max_attempts, replans_used=task.replans,
                                        max_replans=self.settings.max_replans_per_task, retry_policy=policy)
        verified_failure = decision.action in (RecoveryAction.FAIL, RecoveryAction.BLOCK, RecoveryAction.REPAIR) \
            or failure.error_class == ErrorClass.VERIFICATION_FAILED
        record = FailureRecord(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                               attempt_id=attempt.id if attempt else None, tool_name=tool.spec.name,
                               error_class=failure.error_class.value, error_code=failure.code,
                               message=failure.message[:2000], fingerprint=failure.fingerprint(tool.spec.name),
                               verified=verified_failure, strategy_version=rc.strategy.version,
                               context_metadata={"attempt": step.attempt_count, "decision": decision.action.value,
                                                 "category": tool.spec.category,
                                                 "permission_level": tool.spec.permission_level.value})
        s.add(record)
        await s.flush()
        s.add(RecoveryAttempt(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                              failure_record_id=record.id, decision=decision.action.value, reason=decision.reason,
                              details={"delay_seconds": decision.delay_seconds}))
        step.error_class = failure.error_class.value
        step.error_code = failure.code
        step.error_message = failure.message[:2000]
        await append_event(s, task, EventType.RECOVERY_DECIDED, step_id=step.id,
                           payload={"step": step.step_key, "decision": decision.action.value,
                                    "reason": decision.reason, "error_class": failure.error_class.value})
        if step.status in (StepStatus.PENDING.value, StepStatus.RETRY_SCHEDULED.value):
            transition_step(step, StepStatus.RUNNING)

        if decision.action == RecoveryAction.RETRY:
            transition_step(step, StepStatus.RETRY_SCHEDULED)
            step.next_attempt_at = utcnow() + timedelta(seconds=decision.delay_seconds)
            metrics.retry_total.labels("step", failure.error_class.value).inc()
            await append_event(s, task, EventType.RETRY_SCHEDULED, step_id=step.id,
                               payload={"step": step.step_key, "delay_seconds": round(decision.delay_seconds, 2)})
            self._log(s, task, step, "warning", f"Temporary problem ({failure.error_class.value}); will retry.")
        elif decision.action == RecoveryAction.RECONCILE:
            transition_step(step, StepStatus.REQUIRES_RECONCILIATION)
            await append_event(s, task, EventType.RECONCILIATION_REQUIRED, step_id=step.id,
                               payload={"step": step.step_key, "reason": decision.reason})
            self._log(s, task, step, "warning", "Outcome unknown; checking the external system before any retry.")
        elif decision.action == RecoveryAction.REQUEST_USER:
            transition_step(step, StepStatus.WAITING_INPUT)
            question = decision.question or failure.message
            task.pending_questions = [question]
            input_meta = dict(task.input_context or {})
            input_meta["pending_input"] = {"step_id": str(step.id), "step_key": step.step_key,
                                           "question": question, "details": failure.details}
            task.input_context = input_meta
            self._log(s, task, step, "info", f"Needs your input: {question}")
        elif decision.action == RecoveryAction.BLOCK:
            transition_step(step, StepStatus.BLOCKED)
            self._log(s, task, step, "warning", f"Blocked: {decision.reason}.")
        elif decision.action == RecoveryAction.REPAIR:
            transition_step(step, StepStatus.FAILED)
            await self._request_replan(s, task, reason=f"step '{step.step_key}' failed: {failure.message[:500]}")
        else:
            transition_step(step, StepStatus.FAILED)
            await append_event(s, task, EventType.STEP_FAILED, step_id=step.id,
                               payload={"step": step.step_key, "error": failure.code, "message": failure.message[:500]})
            self._log(s, task, step, "error", f"Failed: {failure.message[:300]}")
        return decision

    async def _request_replan(self, s: AsyncSession, task: Task, *, reason: str) -> None:
        task.replans += 1
        meta = dict(task.execution_metadata or {})
        meta["replan_reason"] = reason[:1000]
        task.execution_metadata = meta
        await transition_task(s, task, TaskStatus.PLANNING, reason="re-planning after a repairable failure")
        await self.queue.enqueue(s, JobSpec(queue=Queues.PLANNING, job_type="task.plan",
                                            payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id),
                                                     "mode": "replan"},
                                            dedupe_key=f"plan:{task.id}", tenant_id=task.tenant_id,
                                            priority=task.priority))

    async def _fail_step_now(self, s: AsyncSession, task: Task, step: TaskStep, cls: ErrorClass, code: str,
                             message: str) -> None:
        if step.status in (StepStatus.PENDING.value, StepStatus.RETRY_SCHEDULED.value):
            transition_step(step, StepStatus.RUNNING)
        transition_step(step, StepStatus.FAILED)
        step.error_class, step.error_code, step.error_message = cls.value, code, message[:2000]
        await append_event(s, task, EventType.STEP_FAILED, step_id=step.id,
                           payload={"step": step.step_key, "error": code})

    # ------------------------------------------------------------------ verification
    async def _args_for(self, s: AsyncSession, tool: Tool[Any, Any], step: TaskStep) -> Any:
        return tool.parse_args(step.resolved_arguments or {})

    async def _verify_step(self, rc: RunContext, step_id: uuid.UUID) -> None:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, step_id)
            if step.status != StepStatus.VERIFYING.value:
                await s.commit()
                return
            tool = await self.resolver.resolve(s, rc.tenant_id, step.tool_name, step.tool_version)
            args = await self._args_for(s, tool, step)
            tctx = self._tool_context(rc, task, step, step.idempotency_key, step.attempt_count)
            result = ToolResult(output=step.output or {}, external_ref=step.external_ref,
                                summary=step.output_summary or "")
            await append_event(s, task, EventType.VERIFICATION_STARTED, step_id=step.id,
                               payload={"step": step.step_key, "method": tool.spec.verification_method})
            await s.commit()

        tuning = rc.strategy.config.verification_readback.get(tool.spec.name)
        attempts = tuning.attempts if tuning else rc.agent.verification_policy.readback_attempts
        delay_ms = tuning.delay_ms if tuning else rc.agent.verification_policy.readback_delay_ms
        outcome: VerificationOutcome | None = None
        verify_error: BaseException | None = None
        for i in range(max(1, attempts)):
            try:
                with span("tool.verify", **{"tool.name": tool.spec.name, "task.id": rc.task_id}):
                    outcome = await asyncio.wait_for(tool.verify(tctx, args, result),
                                                     timeout=min(120.0, tool.spec.timeout_seconds * 2))
                verify_error = None
            except Exception as exc:  # verification itself failed to run: never counts as success
                verify_error = exc
                outcome = None
            if outcome is not None and (outcome.passed or not outcome.retryable):
                break
            if i < attempts - 1:
                await asyncio.sleep(delay_ms / 1000 * (i + 1))
        if outcome is None:
            outcome = VerificationOutcome(
                status=VerificationStatus.INCONCLUSIVE, method=tool.spec.verification_method,
                evidence={"error": type(verify_error).__name__ if verify_error else "no outcome"})
        await self._record_verification(rc, step_id, tool, outcome)

    async def _record_verification(self, rc: RunContext, step_id: uuid.UUID, tool: Tool[Any, Any],
                                   outcome: VerificationOutcome) -> None:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, step_id)
            if step.status != StepStatus.VERIFYING.value:
                await s.commit()
                return
            s.add(VerificationResult(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id, scope="step",
                                     status=outcome.status.value, method=outcome.method,
                                     expected=bound_structure(outcome.expected), observed=bound_structure(outcome.observed),
                                     differences=[d.model_dump(mode="json") for d in outcome.differences],
                                     evidence=bound_structure(outcome.evidence)))
            step.verification_status = outcome.status.value
            step.verification_method = outcome.method
            if outcome.passed:
                metrics.verification_pass_total.labels(outcome.method).inc()
                transition_step(step, StepStatus.COMPLETED)
                step.error_class = step.error_code = step.error_message = None
                await append_event(s, task, EventType.VERIFICATION_PASSED, step_id=step.id,
                                   payload={"step": step.step_key, "method": outcome.method})
                await append_event(s, task, EventType.STEP_COMPLETED, step_id=step.id,
                                   payload={"step": step.step_key, "summary": step.output_summary})
                self._log(s, task, step, "info", f"Verified ({outcome.method}): {step.output_summary}")
                await self._update_progress(s, task)
            else:
                metrics.verification_fail_total.labels(outcome.method).inc()
                await append_event(s, task, EventType.VERIFICATION_FAILED, step_id=step.id,
                                   payload={"step": step.step_key, "method": outcome.method,
                                            "status": outcome.status.value,
                                            "differences": [d.field for d in outcome.differences][:10]})
                if tool.spec.has_side_effects:
                    # The action happened (or may have): never retry blindly. Ask the user to review.
                    transition_step(step, StepStatus.REQUIRES_RECONCILIATION)
                    step.error_class = ErrorClass.VERIFICATION_FAILED.value
                    step.error_code = (VERIFY_INCONCLUSIVE if outcome.status == VerificationStatus.INCONCLUSIVE
                                       else "verification_mismatch")
                    step.error_message = ("The action could not be verified automatically. Please confirm "
                                          "whether it completed correctly." if outcome.status ==
                                          VerificationStatus.INCONCLUSIVE else
                                          "The result did not match what was requested: " +
                                          ", ".join(d.field for d in outcome.differences[:5]))
                    s.add(FailureRecord(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id,
                                        tool_name=tool.spec.name, error_class=ErrorClass.VERIFICATION_FAILED.value,
                                        error_code=step.error_code, message=step.error_message, verified=True,
                                        fingerprint=canonical_hash([tool.spec.name, "verification",
                                                                    step.error_code])[:64],
                                        strategy_version=rc.strategy.version,
                                        context_metadata={"differences": [d.model_dump(mode="json")
                                                                          for d in outcome.differences][:10]}))
                    self._log(s, task, step, "warning", step.error_message)
                else:
                    failure = ClassifiedFailure(ErrorClass.VERIFICATION_FAILED, "verification_failed",
                                                "The result failed verification")
                    await self._apply_failure(s, rc, task, step, tool, failure, attempt=None)
            await s.commit()

    # ------------------------------------------------------------------ reconciliation
    async def _reconcile_step(self, rc: RunContext, step_id: uuid.UUID) -> None:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, step_id)
            if step.status != StepStatus.REQUIRES_RECONCILIATION.value:
                await s.commit()
                return
            tool = await self.resolver.resolve(s, rc.tenant_id, step.tool_name, step.tool_version)
            args = await self._args_for(s, tool, step)
            tctx = self._tool_context(rc, task, step, step.idempotency_key, step.attempt_count)
            await s.commit()
        try:
            with span("tool.reconcile", **{"tool.name": tool.spec.name, "task.id": rc.task_id}):
                outcome = await asyncio.wait_for(tool.reconcile(tctx, args), timeout=tool.spec.timeout_seconds * 2)
        except Exception as exc:
            from app.tools.base import ReconcileOutcome

            outcome = ReconcileOutcome(status=ReconcileStatus.UNKNOWN, evidence={"error": type(exc).__name__})
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            step = await task_repo.lock_step(s, step_id)
            if step.status != StepStatus.REQUIRES_RECONCILIATION.value:
                await s.commit()
                return
            ledger = (await s.execute(select(ExternalAction).where(
                ExternalAction.idempotency_key == step.idempotency_key).with_for_update())).scalar_one_or_none()
            if outcome.status == ReconcileStatus.FOUND and outcome.result is not None:
                if ledger is not None:
                    ledger.status = "succeeded"
                    ledger.external_ref = outcome.result.external_ref
                    ledger.result = bound_structure(outcome.result.output, max_items=MAX_OUTPUT_JSON_ITEMS)
                    ledger.reconciled_at = utcnow()
                await self._store_output(s, task, step, tool, outcome.result, await self._tainted(s, task, step))
                transition_step(step, StepStatus.VERIFYING)
                step.error_code = None
                await append_event(s, task, EventType.RECONCILIATION_RESOLVED, step_id=step.id,
                                   payload={"step": step.step_key, "outcome": "found"})
                self._log(s, task, step, "info", "Confirmed the earlier attempt took effect; not repeating it.")
            elif outcome.status == ReconcileStatus.NOT_FOUND:
                if ledger is not None:
                    ledger.status = "failed"
                    ledger.reconciled_at = utcnow()
                policy = self._retry_policy(rc, tool, step)
                if step.attempt_count >= policy.max_attempts:
                    transition_step(step, StepStatus.FAILED)
                    step.error_message = "The action did not take effect and retries are exhausted."
                    await append_event(s, task, EventType.STEP_FAILED, step_id=step.id,
                                       payload={"step": step.step_key, "error": "retries_exhausted"})
                else:
                    transition_step(step, StepStatus.PENDING)
                    step.error_code = None
                await append_event(s, task, EventType.RECONCILIATION_RESOLVED, step_id=step.id,
                                   payload={"step": step.step_key, "outcome": "not_found"})
                self._log(s, task, step, "info", "Confirmed the earlier attempt did not take effect; safe to retry.")
            else:
                step.error_code = RECON_UNKNOWN
                step.error_message = ("I couldn't determine whether this action completed. Please check and "
                                      "confirm, so it is not repeated by mistake.")
                await append_event(s, task, EventType.RECONCILIATION_REQUIRED, step_id=step.id,
                                   payload={"step": step.step_key, "outcome": "unknown",
                                            "evidence": bound_structure(outcome.evidence, max_items=10)})
            await s.commit()
        if outcome.status == ReconcileStatus.FOUND:
            await self._verify_step(rc, step_id)

    # ------------------------------------------------------------------ settle / finalize
    async def _settle(self, rc: RunContext) -> str:
        async with self._session(rc.tenant_id) as s:
            task = await task_repo.lock_task(s, rc.task_id)
            if task.status != TaskStatus.RUNNING.value:
                await s.commit()
                return task.status
            steps = await task_repo.current_steps(s, task)
            statuses = {StepStatus(st.status) for st in steps}
            if all(StepStatus(st.status) in STEP_TERMINAL for st in steps):
                if any(st.status in (StepStatus.FAILED.value, StepStatus.SKIPPED.value, StepStatus.CANCELLED.value)
                       for st in steps):
                    first = next(st for st in steps if st.status == StepStatus.FAILED.value) if any(
                        st.status == StepStatus.FAILED.value for st in steps) else steps[0]
                    await self._fail_task(s, task, first.error_code or "step_failed",
                                          first.error_message or "A step did not complete.")
                else:
                    await self._complete_task(s, rc, task, steps)
            elif StepStatus.WAITING_APPROVAL in statuses:
                await transition_task(s, task, TaskStatus.WAITING_APPROVAL, reason="waiting for approval")
            elif StepStatus.WAITING_INPUT in statuses:
                await transition_task(s, task, TaskStatus.WAITING_INPUT, reason="waiting for user input",
                                      payload={"questions": task.pending_questions or []})
                await append_event(s, task, EventType.INPUT_REQUIRED,
                                   payload={"questions": task.pending_questions or []})
                await notify(s, tenant_id=task.tenant_id, user_id=task.user_id,
                             event=NotificationEvent.INPUT_REQUIRED, title="Your task needs input",
                             body="; ".join(task.pending_questions or [])[:1000], data={"task_id": str(task.id)},
                             idempotency_key=f"input:{task.id}:{task.event_seq}")
            elif StepStatus.BLOCKED in statuses:
                await transition_task(s, task, TaskStatus.BLOCKED, reason="blocked; user action required")
                blocked = next(st for st in steps if st.status == StepStatus.BLOCKED.value)
                task.failure_code, task.failure_message = blocked.error_code, blocked.error_message
                await notify(s, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.TASK_FAILED,
                             title="Your task is blocked", body=blocked.error_message or "Action required",
                             data={"task_id": str(task.id)}, idempotency_key=f"blocked:{task.id}:{blocked.id}")
            elif StepStatus.REQUIRES_RECONCILIATION in statuses:
                await transition_task(s, task, TaskStatus.REQUIRES_RECONCILIATION,
                                      reason="an action's outcome needs confirmation")
                await notify(s, tenant_id=task.tenant_id, user_id=task.user_id,
                             event=NotificationEvent.INPUT_REQUIRED, title="Please confirm an action's outcome",
                             body="AgentOS could not verify whether an action completed and will not repeat it "
                                  "without your confirmation.", data={"task_id": str(task.id)},
                             idempotency_key=f"reconcile:{task.id}:{task.event_seq}")
            elif StepStatus.RETRY_SCHEDULED in statuses:
                next_at = min(ensure_aware(st.next_attempt_at) for st in steps
                              if st.status == StepStatus.RETRY_SCHEDULED.value and st.next_attempt_at)
                await transition_task(s, task, TaskStatus.QUEUED, reason="retry scheduled")
                await self._enqueue_execute(s, task,
                                            delay_seconds=max(0.0, (next_at - utcnow()).total_seconds()))
            elif StepStatus.WAITING_EXTERNAL in statuses:
                pass  # an isolated worker (browser) will resume the task when it finishes
            else:
                await transition_task(s, task, TaskStatus.QUEUED, reason="re-evaluating")
                await self._enqueue_execute(s, task, delay_seconds=2)
            await s.commit()
            return task.status

    async def _complete_task(self, s: AsyncSession, rc: RunContext, task: Task, steps: list[TaskStep]) -> None:
        """Final verification: every step verified, no unresolved external actions."""
        unverified = [st.step_key for st in steps if st.verification_status != VerificationStatus.PASSED.value]
        unresolved = int((await s.execute(select(func.count()).select_from(ExternalAction).where(
            ExternalAction.task_id == task.id, ExternalAction.status == "pending"))).scalar_one())
        await transition_task(s, task, TaskStatus.VERIFYING, reason="final verification")
        if unverified or unresolved:
            s.add(VerificationResult(tenant_id=task.tenant_id, task_id=task.id, scope="task",
                                     status=VerificationStatus.FAILED.value,
                                     method=VerificationMethod.STATE_COMPARISON,
                                     differences=[Difference(field="steps", expected="all verified",
                                                             observed=unverified).model_dump(mode="json")],
                                     evidence={"unresolved_external_actions": unresolved}))
            await transition_task(s, task, TaskStatus.REQUIRES_RECONCILIATION,
                                  reason="final verification found unverified work")
            return
        refs = [{"step": st.step_key, "tool": st.tool_name, "external_ref": st.external_ref}
                for st in steps if st.permission_level != PermissionLevel.READ.value]
        s.add(VerificationResult(tenant_id=task.tenant_id, task_id=task.id, scope="task",
                                 status=VerificationStatus.PASSED.value, method=VerificationMethod.STATE_COMPARISON,
                                 expected={"steps": len(steps)}, observed={"verified_steps": len(steps)},
                                 evidence={"side_effects": refs}))
        task.progress = 1.0
        task.pending_questions = None
        task.failure_code = task.failure_message = None
        task.result_summary = await build_summary(s, task)
        await transition_task(s, task, TaskStatus.COMPLETED, reason="all steps verified")
        metrics.task_completed_total.inc()
        audit.record(s, category=AuditCategory.TASK, action="task.completed", tenant_id=task.tenant_id,
                     user_id=task.user_id, actor_type="worker", task_id=task.id,
                     result_summary=(task.result_summary or {}).get("headline"))
        await notify(s, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.TASK_COMPLETED,
                     title="Task completed", body=(task.result_summary or {}).get("headline", "Done"),
                     data={"task_id": str(task.id)}, idempotency_key=f"completed:{task.id}")
        if rc.agent.memory_policy.enabled and rc.agent.memory_policy.extract_after_task:
            await self.queue.enqueue(s, JobSpec(queue=Queues.MEMORY, job_type="memory.extract",
                                                payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                                                dedupe_key=f"memory.extract:{task.id}", tenant_id=task.tenant_id))

    async def _fail_task(self, s: AsyncSession, task: Task, code: str, message: str) -> None:
        task.failure_code = code[:80]
        task.failure_message = message[:2000]
        task.result_summary = await build_summary(s, task)
        await self._force_status(s, task, TaskStatus.FAILED, code)
        metrics.task_failed_total.labels(code[:40]).inc()
        audit.record(s, category=AuditCategory.TASK, action="task.failed", status="failure", tenant_id=task.tenant_id,
                     user_id=task.user_id, actor_type="worker", task_id=task.id, result_summary=message[:500])
        await notify(s, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.TASK_FAILED,
                     title="Task failed", body=message[:1000], data={"task_id": str(task.id), "code": code},
                     idempotency_key=f"failed:{task.id}:{task.event_seq}")
        await self.queue.enqueue(s, JobSpec(queue=Queues.EVALUATION, job_type="acbe.analyze_task_failures",
                                            payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                                            dedupe_key=f"acbe:{task.id}", tenant_id=task.tenant_id,
                                            delay_seconds=5))

    async def _finalize_cancel(self, s: AsyncSession, task: Task) -> None:
        steps = await task_repo.current_steps(s, task, lock=True)
        for st in steps:
            if st.status in (StepStatus.PENDING.value, StepStatus.WAITING_APPROVAL.value,
                             StepStatus.WAITING_INPUT.value, StepStatus.RETRY_SCHEDULED.value,
                             StepStatus.BLOCKED.value):
                transition_step(st, StepStatus.CANCELLED)
        await approvals.cancel_for_task(s, task, reason="task cancelled")
        # Anything in flight (RUNNING/WAITING_EXTERNAL/REQUIRES_RECONCILIATION) is reported honestly.
        task.result_summary = await build_summary(s, task)
        if task.status != TaskStatus.CANCEL_REQUESTED.value:
            await self._force_status(s, task, TaskStatus.CANCEL_REQUESTED, "cancel requested")
        unresolved = [st for st in steps if st.status in (StepStatus.REQUIRES_RECONCILIATION.value,
                                                           StepStatus.WAITING_EXTERNAL.value)]
        if unresolved:
            await transition_task(s, task, TaskStatus.REQUIRES_RECONCILIATION,
                                  reason="cancelled with an action of unknown outcome")
        else:
            await transition_task(s, task, TaskStatus.CANCELLED, reason="cancelled by user")
        audit.record(s, category=AuditCategory.TASK, action="task.cancelled", tenant_id=task.tenant_id,
                     user_id=task.user_id, actor_type="worker", task_id=task.id)

    async def _update_progress(self, s: AsyncSession, task: Task) -> None:
        total, done = (await s.execute(select(func.count(), func.count().filter(
            TaskStep.status == StepStatus.COMPLETED.value)).where(
            TaskStep.task_id == task.id, TaskStep.plan_version == task.plan_version))).one()
        task.progress = round(float(done) / float(total), 3) if total else 0.0

    def _log(self, s: AsyncSession, task: Task, step: TaskStep | None, level: str, message: str) -> None:
        s.add(ExecutionLog(tenant_id=task.tenant_id, task_id=task.id, step_id=step.id if step else None,
                           level=level, message=clean_text(message, max_chars=1000)))


def build_engine(worker_id: str) -> ExecutionEngine:
    from app.core.database import get_session_factory
    from app.tools.services import get_tool_services
    from app.workers.queues.postgres import get_job_queue

    return ExecutionEngine(services=get_tool_services(), session_factory=get_session_factory(),
                           queue=get_job_queue(), worker_id=worker_id)


__all__ = ["ExecutionEngine", "RecoveryAction", "add_usage", "build_engine"]
