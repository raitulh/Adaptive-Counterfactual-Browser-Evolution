"""EvaluationHarness: runs one EvaluationCase end to end through the *real* planner,
validator, permission engine, approvals, execution engine, adapters, verification
and recovery code — against a simulated Google Workspace — and scores the outcome
against the simulator's state.

Isolation per case:

* a fresh evaluation user (``eval+<uuid>@agentos.invalid``) and organization
  (``eval-<run>``), deleted (cascade) when the case finishes;
* jobs of that tenant are diverted to a private queue (``evaluation-sandbox``) that no
  production worker listens on, and are processed inline by ``Worker._process`` through a
  claim helper that only ever claims rows whose ``tenant_id`` is the evaluation tenant
  (``FOR UPDATE SKIP LOCKED``) — the harness never takes production jobs and production
  workers never take evaluation jobs;
* simulated time (delayed jobs, scheduled step retries) is fast-forwarded for that tenant only.

The harness swaps process-level singletons (tool services, model router, job queue), so
runs are serialised per process with an ``asyncio.Lock`` and the singletons are restored
afterwards. Run evaluations on the dedicated ``evaluation`` worker queue, never inside
API processes or general-purpose workers with other queues.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import secrets
import time as monotonic
import uuid
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta
from email.utils import getaddresses
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
from pydantic import SecretStr
from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.acbe.runtime import StrategyConfig
from app.approvals import service as approvals_service
from app.approvals.models import ApprovalRequest
from app.auth import service as auth_service
from app.common.context import RequestContext
from app.core.config import get_settings
from app.core.database import get_session_factory, system_session, tenant_session
from app.core.exceptions import AppError, ModelUnavailable
from app.core.redis import get_redis
from app.evaluation.cases import EvaluationCase, scopes_for_capabilities
from app.evaluation.metrics import CaseObservation, CaseScore, SideEffect, StepObservation, score_case
from app.evaluation.simulators.eventual import LaggyGoogleWorkspace
from app.evaluation.simulators.google_workspace import Failure, FakeGoogleWorkspace
from app.evaluation.simulators.storage import MemoryStorage
from app.integrations.google.oauth import GoogleIdentity, GoogleOAuthClient, GoogleTokenResponse
from app.integrations.service import store_google_connection
from app.integrations.vault import CredentialVault
from app.model_gateway.providers.scripted import ScriptedProvider
from app.model_gateway.router import ModelRouter, build_model_router, set_model_router
from app.model_gateway.types import ModelRequest
from app.organizations import repository as org_repo
from app.organizations.models import Organization
from app.recovery.models import RecoveryAttempt
from app.tasks import repository as task_repo
from app.tasks.schemas import StepConfirmation, TaskCreate, TaskInput
from app.tasks.service import confirm_step, create_task, provide_input
from app.tools.services import ToolServices, set_tool_services
from app.users.models import User
from app.verification.models import VerificationResult
from app.workers.queues.base import ClaimedJob, JobSpec, Queues
from app.workers.queues.models import Job
from app.workers.queues.postgres import PostgresJobQueue, get_job_queue, set_job_queue
from app.workers.worker import Worker

logger = logging.getLogger(__name__)

SANDBOX_QUEUE = "evaluation-sandbox"
DEFAULT_JOB_TYPES: tuple[str, ...] = ("task.plan", "task.execute")
MAX_ROUNDS = 12
MAX_JOBS_PER_ROUND = 150
ModelMode = Literal["scripted", "configured"]

_RUN_LOCK = asyncio.Lock()

_TENANT_CLAIM_SQL = text(
    """
    UPDATE jobs SET status = 'running', locked_by = :worker, attempts = attempts + 1,
           locked_until = now() + make_interval(secs => :lease), updated_at = now()
    WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'pending' AND tenant_id = :tenant AND job_type = ANY(:job_types) AND run_at <= now()
        ORDER BY priority, run_at
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue, job_type, payload, attempts, max_attempts, tenant_id
    """
)


# ---------------------------------------------------------------------------- tenant-restricted queue access
async def claim_tenant_jobs(tenant_id: uuid.UUID, *, worker_id: str, job_types: tuple[str, ...] = DEFAULT_JOB_TYPES,
                            limit: int = 1, lease_seconds: int | None = None) -> list[ClaimedJob]:
    """Claim due jobs belonging to ``tenant_id`` only (any queue). Rows of other tenants and
    tenant-less rows are never selected, so production work can never be taken."""
    lease = lease_seconds or get_settings().job_lease_seconds
    async with system_session() as session:
        rows = (await session.execute(_TENANT_CLAIM_SQL, {
            "worker": worker_id, "lease": lease, "tenant": tenant_id, "job_types": list(job_types),
            "limit": limit})).mappings().all()
        await session.commit()
    return [ClaimedJob(id=r["id"], queue=r["queue"], job_type=r["job_type"], payload=r["payload"] or {},
                       attempts=r["attempts"], max_attempts=r["max_attempts"], tenant_id=r["tenant_id"])
            for r in rows]


async def fast_forward_tenant(tenant_id: uuid.UUID) -> None:
    """Simulated passage of time for one tenant: delayed jobs and scheduled step retries become due."""
    async with system_session() as session:
        await session.execute(text("UPDATE jobs SET run_at = now() WHERE status = 'pending' AND tenant_id = :t "
                                   "AND run_at > now()"), {"t": tenant_id})
        await session.execute(text("UPDATE task_steps SET next_attempt_at = now() WHERE tenant_id = :t "
                                   "AND status = 'retry_scheduled' AND next_attempt_at > now()"), {"t": tenant_id})
        await session.commit()


class SandboxJobQueue(PostgresJobQueue):
    """Diverts jobs of one evaluation tenant to a private queue; everything else passes through."""

    def __init__(self, tenant_id: uuid.UUID) -> None:
        super().__init__(get_session_factory())
        self.tenant_id = tenant_id

    async def enqueue(self, session: AsyncSession, spec: JobSpec) -> None:
        if spec.tenant_id == self.tenant_id:
            spec = replace(spec, queue=SANDBOX_QUEUE)
        await super().enqueue(session, spec)


# ---------------------------------------------------------------------------- simulator helpers
def _clock(value: str) -> time:
    hour, minute = (int(x) for x in value.split(":"))
    return time(hour, minute)


def _recipients(message: dict[str, Any]) -> tuple[str, ...]:
    headers = message.get("payload", {}).get("headers", [])
    values = [h["value"] for h in headers if h.get("name", "").lower() in ("to", "cc", "bcc")]
    return tuple(sorted({addr.lower() for _, addr in getaddresses(values) if addr}))


@dataclass(slots=True)
class EnvironmentSnapshot:
    events: dict[str, str]
    messages: set[str]
    drafts: set[str]


def snapshot(google: FakeGoogleWorkspace) -> EnvironmentSnapshot:
    return EnvironmentSnapshot(events={k: json.dumps(v, sort_keys=True) for k, v in google.calendar_events.items()},
                               messages=set(google.messages), drafts=set(google.drafts))


def side_effects_since(google: FakeGoogleWorkspace, before: EnvironmentSnapshot) -> list[SideEffect]:
    effects: list[SideEffect] = []
    for event_id, event in google.calendar_events.items():
        if event_id not in before.events:
            if event.get("status") != "cancelled":
                attendees = tuple(sorted(str(a.get("email", "")).lower() for a in event.get("attendees", [])))
                effects.append(SideEffect("calendar_event", event_id, attendees, event.get("summary")))
        elif json.dumps(event, sort_keys=True) != before.events[event_id]:
            effects.append(SideEffect("calendar_change", event_id, summary=event.get("summary")))
    for message_id, message in google.messages.items():
        if message_id not in before.messages and "SENT" in message.get("labelIds", []):
            effects.append(SideEffect("email", message_id, _recipients(message)))
    for draft_id in google.drafts:
        if draft_id not in before.drafts:
            effects.append(SideEffect("draft", draft_id))
    return effects


# ---------------------------------------------------------------------------- harness
@dataclass(slots=True)
class _Sandbox:
    case: EvaluationCase
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    google: FakeGoogleWorkspace
    worker: Worker
    ctx: RequestContext
    task_id: uuid.UUID | None = None
    granted: set[uuid.UUID] = field(default_factory=set)
    questions: list[str] = field(default_factory=list)
    input_requested: bool = False
    answers_used: int = 0
    notes: list[str] = field(default_factory=list)


class EvaluationHarness:
    def __init__(self, *, model_mode: ModelMode = "scripted", job_types: tuple[str, ...] = DEFAULT_JOB_TYPES) -> None:
        self.model_mode = model_mode
        self.job_types = job_types

    async def run_case(self, case: EvaluationCase, *, strategy: StrategyConfig | None = None,
                       label: str = "baseline", run_tag: str = "adhoc") -> CaseScore:
        async with _RUN_LOCK:
            return await self._run(case, strategy or StrategyConfig(), label[:80], run_tag)

    # ------------------------------------------------------------------ lifecycle
    async def _run(self, case: EvaluationCase, strategy: StrategyConfig, label: str, run_tag: str) -> CaseScore:
        run_date = datetime.now(ZoneInfo(case.timezone)).date()
        google: FakeGoogleWorkspace = (LaggyGoogleWorkspace(read_lag=case.environment.calendar_read_lag)
                                       if case.environment.calendar_read_lag else FakeGoogleWorkspace())
        http = httpx.AsyncClient(transport=google.transport())
        previous_queue = get_job_queue()
        principal: tuple[uuid.UUID, uuid.UUID] | None = None
        worker_id = f"eval-{uuid.uuid4().hex[:12]}"
        obs: CaseObservation
        try:
            principal = await self._create_principal(case, run_tag)
            user_id, tenant_id = principal
            queue = SandboxJobQueue(tenant_id)
            set_job_queue(queue)
            model = self._model_router(case)
            set_tool_services(self._tool_services(http, model))
            set_model_router(model)
            worker = Worker([*Queues.DEFAULT_WORKER, Queues.BROWSER, SANDBOX_QUEUE], concurrency=1, queue=queue,
                            worker_id=worker_id, kind="evaluation", run_outbox=False)
            sb = _Sandbox(case=case, user_id=user_id, tenant_id=tenant_id, google=google, worker=worker,
                          ctx=await self._principal_context(user_id, tenant_id))
            await self._setup_environment(sb, run_date)
            before = snapshot(google)
            google.calls.clear()
            started = monotonic.perf_counter()
            sb.task_id = await self._create_task(sb, strategy, label)
            error: str | None = None
            try:
                await self._drive(sb)
            except Exception as exc:  # recorded and scored as a failed case, never swallowed silently
                logger.warning("evaluation case raised", extra={"case": case.id}, exc_info=True)
                error = f"{type(exc).__name__}: {exc}"[:500]
            latency_ms = (monotonic.perf_counter() - started) * 1000
            obs = await self._observe(sb, before, run_date, latency_ms)
            obs.error = error
        except Exception as exc:
            logger.warning("evaluation case setup failed", extra={"case": case.id}, exc_info=True)
            obs = CaseObservation(case_id=case.id, task_status=None, run_date=run_date,
                                  error=f"{type(exc).__name__}: {exc}"[:500])
        finally:
            await http.aclose()
            set_tool_services(None)
            set_model_router(None)
            set_job_queue(previous_queue)
            _forget_engine(worker_id)
            if principal is not None:
                await self._destroy_principal(*principal)
        return score_case(case, obs)

    async def _create_principal(self, case: EvaluationCase, run_tag: str) -> tuple[uuid.UUID, uuid.UUID]:
        email = f"eval+{uuid.uuid4().hex}@agentos.invalid"
        async with get_session_factory()() as session:
            issued = await auth_service.register(
                session, email=email, password=secrets.token_urlsafe(24) + "aA1!",
                display_name="AgentOS Evaluation", organization_name=f"eval-{run_tag}"[:200],
                timezone=case.timezone,
                client=auth_service.ClientInfo(user_agent="agentos-evaluation", device_name="evaluation"))
        return issued.response.user_id, issued.response.tenant_id

    async def _destroy_principal(self, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
        """Delete everything the case created: its jobs, its organization (cascade) and its user."""
        try:
            async with system_session() as session:
                await session.execute(delete(Job).where(Job.tenant_id == tenant_id))
                await session.execute(delete(Organization).where(Organization.id == tenant_id))
                await session.execute(delete(User).where(User.id == user_id))
                await session.commit()
        except Exception:
            logger.exception("failed to delete evaluation tenant", extra={"tenant_id": str(tenant_id)})

    async def _principal_context(self, user_id: uuid.UUID, tenant_id: uuid.UUID) -> RequestContext:
        async with tenant_session(tenant_id) as session:
            membership = await org_repo.get_active_membership(session, user_id, tenant_id)
            if membership is None:
                raise RuntimeError("evaluation principal has no membership")
            _, role, _ = membership
            permissions = await org_repo.role_permissions(session, role.id)
            user = await session.get(User, user_id)
            return RequestContext(user_id=user_id, tenant_id=tenant_id, role=role.name, permissions=permissions,
                                  timezone=user.timezone if user else "UTC", email=user.email if user else None,
                                  actor_type="user", user_agent="agentos-evaluation")

    def _model_router(self, case: EvaluationCase) -> ModelRouter:
        if case.use_model or case.plan is None:
            if self.model_mode != "configured":
                raise ModelUnavailable("This case needs the configured model (model_mode='configured').")
            return build_model_router()
        plans = [json.dumps(case.plan), *(json.dumps(p) for p in case.replans)]
        calls = {"planning": 0}

        def handle(request: ModelRequest) -> str | Exception:
            if request.metadata.purpose == "planning":
                index = min(calls["planning"], len(plans) - 1)
                calls["planning"] += 1
                return plans[index]
            return ModelUnavailable(f"no scripted response for {request.metadata.purpose}")

        return ModelRouter(ScriptedProvider(handle), usage_sink=None)

    def _tool_services(self, http: httpx.AsyncClient, model: ModelRouter) -> ToolServices:
        settings = get_settings()
        # The OAuth client talks to the simulator only; placeholder client credentials never leave the process.
        oauth_settings = settings.model_copy(update={
            "google_client_id": "agentos-evaluation.apps.googleusercontent.com",
            "google_client_secret": SecretStr("agentos-evaluation-simulator")})
        sf = get_session_factory()
        return ToolServices(session_factory=sf,
                            vault=CredentialVault(sf, google_oauth=GoogleOAuthClient(oauth_settings, http=http),
                                                  redis=get_redis()),
                            model=model, google_http=http, storage=MemoryStorage(), search=None)

    # ------------------------------------------------------------------ environment
    async def _setup_environment(self, sb: _Sandbox, run_date: date) -> None:
        env, google = sb.case.environment, sb.google
        tz = ZoneInfo(sb.case.timezone)
        for contact in env.contacts:
            google.add_contact(contact.name, contact.email)
        for busy in env.busy:
            day = run_date + timedelta(days=busy.day_offset)
            google.add_busy(datetime.combine(day, _clock(busy.start), tz), datetime.combine(day, _clock(busy.end), tz))
        for message in env.messages:
            google.add_message(sender=message.sender, to=message.to, subject=message.subject, body=message.body,
                               labels=message.labels)
        for failure in env.failures:
            google.fail(failure.route, Failure(kind=failure.kind, status=failure.status, reason=failure.reason,
                                               times=failure.times, after_effect=failure.after_effect))
        if env.tamper is not None:
            tamper_field, tamper_value = env.tamper.field, env.tamper.value

            def tamper(event: dict[str, Any]) -> None:
                event[tamper_field] = tamper_value

            google.event_tamper = tamper
        if sb.case.setup is not None:
            sb.case.setup(google)
        if env.connect_google:
            await self._connect_google(sb)
        if env.tool_rules or env.internal_email_domains:
            await self._apply_org_rules(sb)
        if env.memories:
            await self._seed_memories(sb)

    async def _connect_google(self, sb: _Sandbox) -> None:
        env = sb.case.environment
        scopes = scopes_for_capabilities(env.capabilities)
        access, refresh = sb.google.issue_tokens(scopes)
        expired = env.google_auth == "expired"
        if expired:  # access token no longer valid and refresh token revoked at the provider
            sb.google.valid_access_tokens.discard(access)
            sb.google.revoked_refresh_tokens.add(refresh)
        async with tenant_session(sb.tenant_id) as session:
            await store_google_connection(
                session, tenant_id=sb.tenant_id, user_id=sb.user_id,
                tokens=GoogleTokenResponse(access_token=access, expires_in=0 if expired else 3600, scope=set(scopes),
                                           token_type="Bearer", refresh_token=refresh),
                identity=GoogleIdentity(subject=f"eval-{sb.user_id}", email="owner@example.com",
                                        email_verified=True, name="Evaluation Owner"))
            await session.commit()

    async def _apply_org_rules(self, sb: _Sandbox) -> None:
        from app.organizations.service import get_policy, update_policy
        from app.tools.models import ToolPermission

        env = sb.case.environment
        async with tenant_session(sb.tenant_id) as session:
            for rule in env.tool_rules:
                session.add(ToolPermission(tenant_id=sb.tenant_id, tool_pattern=rule.tool_pattern,
                                           effect=rule.effect, reason=rule.reason, created_by=sb.user_id))
            await session.commit()
            if env.internal_email_domains:
                policy, _ = await get_policy(session, sb.tenant_id)
                await update_policy(session, sb.ctx, policy.model_copy(
                    update={"internal_email_domains": list(env.internal_email_domains)}))

    async def _seed_memories(self, sb: _Sandbox) -> None:
        from app.memory.models import MemoryType
        from app.memory.schemas import MemoryCreate
        from app.memory.service import create_user_memory

        async with tenant_session(sb.tenant_id) as session:
            for memory in sb.case.environment.memories:
                await create_user_memory(session, sb.ctx, MemoryCreate(
                    content=memory.content, memory_type=MemoryType(memory.memory_type),
                    subject_key=memory.subject_key))

    async def _create_task(self, sb: _Sandbox, strategy: StrategyConfig, label: str) -> uuid.UUID:
        async with tenant_session(sb.tenant_id) as session:
            task, _ = await create_task(session, sb.ctx, TaskCreate(goal=sb.case.goal), source="evaluation")
            meta = dict(task.execution_metadata or {})
            # Pin the strategy so baseline and candidate variants run on identical cases (acbe.runtime.override_for).
            meta["strategy_override"] = strategy.model_dump(mode="json")
            meta["strategy_override_label"] = label
            meta["evaluation_case"] = sb.case.id
            task.execution_metadata = meta
            await session.commit()
            return task.id

    # ------------------------------------------------------------------ driving
    async def _drive(self, sb: _Sandbox) -> None:
        for _ in range(MAX_ROUNDS):
            await self._run_jobs(sb)
            status = await self._task_status(sb)
            if status == "waiting_approval":
                progressed = await self._decide_approvals(sb)
            elif status == "waiting_input":
                progressed = await self._answer_input(sb)
            elif status == "requires_reconciliation":
                progressed = await self._confirm_outcomes(sb)
            else:
                progressed = False
            if not progressed:
                return

    async def _run_jobs(self, sb: _Sandbox) -> int:
        from app.workers.jobs.registry import load_handlers

        load_handlers()
        processed = 0
        while processed < MAX_JOBS_PER_ROUND:
            await fast_forward_tenant(sb.tenant_id)
            jobs = await claim_tenant_jobs(sb.tenant_id, worker_id=sb.worker.worker_id, job_types=self.job_types,
                                           lease_seconds=sb.worker.queue.lease_seconds)
            if not jobs:
                break
            await sb.worker._process(jobs[0])
            processed += 1
        return processed

    async def _task_status(self, sb: _Sandbox) -> str:
        assert sb.task_id is not None
        async with tenant_session(sb.tenant_id) as session:
            task = await task_repo.get_task(session, sb.task_id)
            if task.pending_questions:
                sb.questions.extend(q for q in task.pending_questions if q not in sb.questions)
            if task.status == "waiting_input":
                sb.input_requested = True
            return task.status

    async def _decide_approvals(self, sb: _Sandbox) -> bool:
        async with tenant_session(sb.tenant_id) as session:
            pending = list((await session.execute(select(ApprovalRequest.id, ApprovalRequest.tool_name).where(
                ApprovalRequest.task_id == sb.task_id, ApprovalRequest.status == "pending")
                .order_by(ApprovalRequest.created_at))).all())
        acted = False
        for approval_id, tool_name in pending:
            policy = sb.case.policy_for(tool_name)
            if policy == "never":
                continue
            async with tenant_session(sb.tenant_id) as session:
                try:
                    if policy == "auto_approve":
                        await approvals_service.approve(session, sb.ctx, approval_id, "evaluation policy: approve")
                        sb.granted.add(approval_id)
                    else:
                        await approvals_service.reject(session, sb.ctx, approval_id, "evaluation policy: reject")
                except AppError as exc:
                    sb.notes.append(f"approval decision refused: {exc.code}")
                    continue
            acted = True
        return acted

    async def _answer_input(self, sb: _Sandbox) -> bool:
        assert sb.task_id is not None
        if sb.answers_used >= len(sb.case.user_inputs):
            return False
        answer = sb.case.user_inputs[sb.answers_used]
        sb.answers_used += 1
        async with tenant_session(sb.tenant_id) as session:
            try:
                await provide_input(session, sb.ctx, sb.task_id, TaskInput(answer=answer))
            except AppError as exc:
                sb.notes.append(f"input refused: {exc.code}")
                return False
        return True

    async def _confirm_outcomes(self, sb: _Sandbox) -> bool:
        assert sb.task_id is not None
        if sb.case.confirm_reconciliation == "never":
            return False
        async with tenant_session(sb.tenant_id) as session:
            task = await task_repo.get_task(session, sb.task_id)
            waiting = [s.id for s in await task_repo.current_steps(session, task)
                       if s.status == "requires_reconciliation"]
        confirmed = False
        for step_id in waiting:
            async with tenant_session(sb.tenant_id) as session:
                try:
                    await confirm_step(session, sb.ctx, sb.task_id, step_id,
                                       StepConfirmation(outcome=sb.case.confirm_reconciliation,
                                                        note="evaluation policy"))
                    confirmed = True
                except AppError as exc:
                    sb.notes.append(f"confirmation refused: {exc.code}")
        return confirmed

    # ------------------------------------------------------------------ observation
    async def _observe(self, sb: _Sandbox, before: EnvironmentSnapshot, run_date: date, latency_ms: float
                       ) -> CaseObservation:
        assert sb.task_id is not None
        async with tenant_session(sb.tenant_id) as session:
            task = await task_repo.get_task(session, sb.task_id)
            steps = await task_repo.all_steps(session, sb.task_id)
            approvals = list((await session.execute(select(ApprovalRequest).where(
                ApprovalRequest.task_id == sb.task_id))).scalars().all())
            verification_rows = list((await session.execute(select(VerificationResult.status).where(
                VerificationResult.task_id == sb.task_id, VerificationResult.scope == "step"))).scalars().all())
            recovery_attempts = int((await session.execute(select(func.count()).select_from(RecoveryAttempt).where(
                RecoveryAttempt.task_id == sb.task_id))).scalar_one())
        approved_steps = {a.step_id for a in approvals
                          if a.id in sb.granted and a.status == "approved" and a.consumed_at is not None}
        observed_steps = [StepObservation(
            step_key=s.step_key, tool_name=s.tool_name, plan_version=s.plan_version, position=s.position,
            status=s.status, permission_level=s.permission_level, requires_approval=s.requires_approval,
            attempt_count=s.attempt_count, verification_status=s.verification_status,
            resolved_arguments=s.resolved_arguments, external_ref=s.external_ref, error_class=s.error_class,
            error_code=s.error_code, policy_reasons=list(s.policy_reasons or []),
            approved_by_harness=s.id in approved_steps) for s in steps]
        if task.pending_questions:
            sb.questions.extend(q for q in task.pending_questions if q not in sb.questions)
        return CaseObservation(
            case_id=sb.case.id, task_status=task.status, run_date=run_date, failure_code=task.failure_code,
            steps=observed_steps, side_effects=side_effects_since(sb.google, before),
            provider_calls=[route for route, _ in sb.google.calls],
            verifications_total=len(verification_rows),
            verifications_passed=sum(1 for v in verification_rows if v == "passed"),
            recovery_attempts=recovery_attempts,
            input_requested=sb.input_requested or task.status == "waiting_input", questions=list(sb.questions),
            approvals_requested=len(approvals), approvals_granted=len(sb.granted),
            ungranted_consumed_approvals=sum(1 for a in approvals if a.consumed_at is not None
                                             and a.id not in sb.granted),
            latency_ms=round(latency_ms, 3), cost_usd=round(task.cost_micros / 1_000_000, 6))


def _forget_engine(worker_id: str) -> None:
    """Drop the per-worker engine the execution job module cached for this case's worker id."""
    with contextlib.suppress(Exception):
        from app.execution import jobs as execution_jobs

        execution_jobs._engines.pop(worker_id, None)
