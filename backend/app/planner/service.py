"""PlannerService: goal → validated, persisted task DAG. The planner never executes tools.

    CREATED → PLANNING → (model: structured plan) → PlanValidator
        ├─ issues & repairs left → re-plan with structured errors → validate again
        ├─ questions            → WAITING_INPUT
        ├─ policy denial         → BLOCKED
        └─ valid                → PLANNED → VALIDATING → QUEUED (+ task.execute job)
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.acbe.runtime import resolve_strategy
from app.agents.schemas import ResolvedAgent
from app.agents.service import resolve_agent
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.enums import TrustLevel
from app.common.events import EventType
from app.common.ids import stable_hash
from app.common.time import utcnow
from app.core.config import Settings, get_settings
from app.core.exceptions import ModelOutputInvalid
from app.core.logging import log_context
from app.core.telemetry import span
from app.model_gateway.router import ModelRouter
from app.model_gateway.types import CallMetadata, Message, ModelRequest, ModelTier
from app.organizations import repository as org_repo
from app.permissions.service import Decision, PermissionService, PolicyInputs, load_policy_inputs
from app.planner.context import PlanningContext, build_planner_prompt, tool_catalog_entry
from app.planner.schemas import Plan, PlanIssue
from app.planner.validator import PlanValidator, ValidationResult, issues_as_feedback
from app.tasks import repository as task_repo
from app.tasks.models import Task, TaskDependency, TaskStep
from app.tasks.state import STEP_TERMINAL, StepStatus, TaskStatus, append_event, transition_step, transition_task
from app.tools.registry import ToolResolver
from app.users.models import User
from app.workers.queues.base import JobSpec, Queues

logger = logging.getLogger(__name__)


class PlanningFailed(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(slots=True)
class PlanningInputs:
    principal: RequestContext
    context: PlanningContext
    policy: PolicyInputs
    agent_model_policy: dict[str, Any]
    tier: ModelTier
    remaining_tool_calls: int
    remaining_model_calls: int
    completed_step_ids: set[str]
    saw_untrusted: bool
    strategy_version: str
    agent_label: str
    agent: ResolvedAgent


class PlannerService:
    def __init__(self, model: ModelRouter, session_factory: async_sessionmaker[AsyncSession], queue: Any, *,
                 resolver: ToolResolver | None = None, settings: Settings | None = None) -> None:
        self.model = model
        self.sf = session_factory
        self.queue = queue
        self.resolver = resolver or ToolResolver()
        self.validator = PlanValidator(self.resolver)
        self.permissions = PermissionService()
        self.settings = settings or get_settings()

    async def plan(self, task_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
        with log_context(task_id=task_id, tenant_id=tenant_id), span("task.plan", **{"task.id": task_id}):
            inputs = await self._begin(task_id, tenant_id)
            if inputs is None:
                return "skipped"
            try:
                plan, validation, model_calls, model_meta = await self._generate(task_id, tenant_id, inputs)
            except PlanningFailed as exc:
                await self._finish_failed(task_id, tenant_id, exc.code, exc.message)
                return "failed"
            return await self._persist(task_id, tenant_id, inputs, plan, validation, model_calls, model_meta)

    # ------------------------------------------------------------------ phase 1: load state
    async def _begin(self, task_id: uuid.UUID, tenant_id: uuid.UUID) -> PlanningInputs | None:
        async with self.sf() as s:
            s.info["tenant_id"] = tenant_id
            task = await task_repo.lock_task(s, task_id)
            status = TaskStatus(task.status)
            if task.cancel_requested_at is not None:
                await s.commit()
                return None
            if status == TaskStatus.CREATED:
                await transition_task(s, task, TaskStatus.PLANNING, reason="planning started")
            elif status != TaskStatus.PLANNING:
                await s.commit()
                return None
            await append_event(s, task, EventType.PLANNING_STARTED, payload={"replan": task.plan_version > 0})

            user = await s.get(User, task.user_id)
            membership = await org_repo.get_active_membership(s, task.user_id, tenant_id)
            if user is None or membership is None:
                await s.commit()
                await self._finish_failed(task_id, tenant_id, "principal_revoked",
                                          "The task owner no longer has access.")
                return None
            _, role, _ = membership
            principal = RequestContext(user_id=user.id, tenant_id=tenant_id, role=role.name,
                                       permissions=await org_repo.role_permissions(s, role.id),
                                       timezone=user.timezone, email=user.email, actor_type="worker")
            agent = await resolve_agent(s, task.agent_id, task.agent_version_id)
            policy = await load_policy_inputs(s, tenant_id, agent.tool_policy)
            strategy = await resolve_strategy(s, tenant_id, task.id)

            available = await self.resolver.available(s, tenant_id)
            catalog = []
            for tool in available:
                decision = self.permissions.evaluate(principal, tool.spec, policy)
                if decision.decision != Decision.DENY:
                    catalog.append(tool_catalog_entry(tool.spec))

            memories: list[dict[str, Any]] = []
            if agent.memory_policy.enabled and agent.memory_policy.max_items > 0:
                try:
                    from app.memory.service import retrieve_for_context

                    retrieved = await retrieve_for_context(s, tenant_id=tenant_id, user_id=task.user_id,
                                                           query=task.goal, limit=agent.memory_policy.max_items,
                                                           model_router=self.model)
                    memories = [m.model_dump(mode="json") for m in retrieved]
                except Exception:  # memory is an enhancement; planning proceeds without it
                    logger.warning("memory retrieval failed during planning", exc_info=True)

            prior_steps, untrusted, completed_ids = await self._prior_state(s, task)
            user_inputs = list((task.input_context or {}).get("user_inputs", []))
            user_context = (task.input_context or {}).get("user_context")
            if user_context:
                user_inputs.insert(0, {"question": "Additional context provided with the task",
                                       "answer": str(user_context)[:4000]})
            repair = []
            if (task.execution_metadata or {}).get("replan_reason"):
                repair.append({"code": "previous_execution_failed",
                               "message": task.execution_metadata["replan_reason"]})

            max_steps = min(self.settings.max_plan_steps,
                            agent.execution_limits.max_steps or self.settings.max_plan_steps)
            context = PlanningContext(
                goal=task.goal, now=utcnow(), timezone=user.timezone, user_display_name=user.display_name,
                tools=catalog, agent_instructions=agent.instructions, strategy_hints=strategy.config.planner_hints,
                memories=memories, user_inputs=user_inputs, prior_steps=prior_steps, untrusted=untrusted,
                repair_issues=repair, max_steps=max_steps,
            )
            budget = task.budget or {}
            inputs = PlanningInputs(
                principal=principal, context=context, policy=policy,
                agent_model_policy=agent.model_policy.model_dump(exclude_none=True),
                tier=ModelTier(agent.model_policy.planning_tier),
                remaining_tool_calls=int(budget.get("max_tool_calls", self.settings.max_tool_calls_per_task))
                - task.tool_calls,
                remaining_model_calls=int(budget.get("max_model_calls", self.settings.max_model_calls_per_task))
                - task.model_calls,
                completed_step_ids=completed_ids, saw_untrusted=bool(untrusted), strategy_version=strategy.version,
                agent_label=agent.label, agent=agent,
            )
            await s.commit()
            return inputs

    async def _prior_state(self, s: AsyncSession, task: Task) -> tuple[list[dict[str, Any]], list[tuple[str, str]],
                                                                        set[str]]:
        if task.plan_version == 0:
            return [], [], set()
        steps = await task_repo.all_steps(s, task.id)
        prior: list[dict[str, Any]] = []
        untrusted: list[tuple[str, str]] = []
        for st in steps:
            entry: dict[str, Any] = {"step_id": st.step_key, "tool": st.tool_name, "status": st.status,
                                     "summary": st.output_summary, "error": st.error_message}
            if st.status == StepStatus.COMPLETED.value and st.output is not None:
                if st.output_trust == TrustLevel.UNTRUSTED_EXTERNAL_CONTENT.value:
                    import json

                    untrusted.append((f"output_of_{st.step_key}", json.dumps(st.output, default=str)))
                    entry["output"] = f"see untrusted_content output_of_{st.step_key}"
                else:
                    entry["output"] = st.output
                if st.permission_level != "read":
                    entry["note"] = "ALREADY PERFORMED — do not repeat this action"
            prior.append(entry)
        return prior, untrusted, {st.step_key for st in steps}

    # ------------------------------------------------------------------ phase 2: model + validation (no tx)
    async def _generate(self, task_id: uuid.UUID, tenant_id: uuid.UUID, inputs: PlanningInputs
                        ) -> tuple[Plan, ValidationResult, int, dict[str, Any]]:
        max_repairs = self.settings.max_plan_repair_attempts
        model_calls = 0
        issues_feedback: list[dict[str, Any]] = list(inputs.context.repair_issues)
        last_validation: ValidationResult | None = None
        last_plan: Plan | None = None
        meta: dict[str, Any] = {}
        for attempt in range(max_repairs + 1):
            if model_calls >= max(1, inputs.remaining_model_calls):
                raise PlanningFailed("budget_exceeded", "The task reached its model-call budget while planning.")
            inputs.context.repair_issues = issues_feedback
            system, user_text, min_trust = build_planner_prompt(inputs.context)
            request = ModelRequest(
                system=system, messages=[Message(role="user", text=user_text)], tier=inputs.tier, temperature=0.1,
                metadata=CallMetadata(purpose="planning", tenant_id=tenant_id, user_id=inputs.principal.user_id,
                                      task_id=task_id),
                min_trust=min_trust,
            )
            try:
                plan, responses = await self.model.generate_structured(request, Plan, max_repairs=1,
                                                                       model_policy=inputs.agent_model_policy)
            except ModelOutputInvalid as exc:
                model_calls += 2
                if attempt >= max_repairs:
                    raise PlanningFailed("plan_invalid",
                                         "The planner could not produce a valid plan for this request.") from exc
                issues_feedback = [{"code": "invalid_json", "message": str(exc.details.get("errors"))[:1500]}]
                continue
            model_calls += len(responses)
            meta = {"model": responses[-1].model, "provider": responses[-1].provider,
                    "input_tokens": sum((r.usage.input_tokens or r.usage.input_token_estimate) for r in responses),
                    "output_tokens": sum((r.usage.output_tokens or r.usage.output_token_estimate) for r in responses),
                    "cost_usd": sum(r.usage.cost_usd for r in responses)}
            async with self.sf() as s:
                s.info["tenant_id"] = tenant_id
                validation = await self.validator.validate(
                    s, inputs.principal, plan, agent=inputs.agent,
                    policy=inputs.policy, remaining_tool_calls=max(0, inputs.remaining_tool_calls),
                    completed_step_ids=inputs.completed_step_ids)
            last_plan, last_validation = plan, validation
            if validation.ok or not validation.repairable:
                break
            issues_feedback = issues_as_feedback(validation.issues)
            logger.info("plan rejected; repairing", extra={"attempt": attempt, "issues": len(validation.issues)})
        assert last_plan is not None and last_validation is not None
        meta["model_calls"] = model_calls
        return last_plan, last_validation, model_calls, meta

    # ------------------------------------------------------------------ phase 3: persist
    async def _persist(self, task_id: uuid.UUID, tenant_id: uuid.UUID, inputs: PlanningInputs, plan: Plan,
                       validation: ValidationResult, model_calls: int, meta: dict[str, Any]) -> str:
        async with self.sf() as s:
            s.info["tenant_id"] = tenant_id
            task = await task_repo.lock_task(s, task_id)
            task.model_calls += model_calls
            task.cost_micros += int(float(meta.get("cost_usd", 0.0)) * 1_000_000)
            if task.cancel_requested_at is not None or task.status == TaskStatus.CANCEL_REQUESTED.value:
                await transition_task(s, task, TaskStatus.CANCELLED, reason="cancelled during planning")
                await s.commit()
                return "cancelled"
            if task.status != TaskStatus.PLANNING.value:
                await s.commit()
                return "skipped"
            if not validation.ok:
                await self._reject(s, task, validation.issues)
                await s.commit()
                return task.status
            if plan.needs_user_input:
                task.pending_questions = plan.needs_user_input[:5]
                ctx_meta = dict(task.input_context or {})
                ctx_meta.pop("pending_input", None)
                task.input_context = ctx_meta
                await transition_task(s, task, TaskStatus.WAITING_INPUT, reason="planner needs information",
                                      payload={"questions": task.pending_questions})
                await append_event(s, task, EventType.INPUT_REQUIRED, payload={"questions": task.pending_questions})
                from app.notifications.service import NotificationEvent, notify

                await notify(s, tenant_id=task.tenant_id, user_id=task.user_id,
                             event=NotificationEvent.INPUT_REQUIRED, title="Your task needs more information",
                             body="; ".join(task.pending_questions)[:1000], data={"task_id": str(task.id)},
                             idempotency_key=f"plan-input:{task.id}:{task.event_seq}")
                await s.commit()
                return task.status

            await transition_task(s, task, TaskStatus.PLANNED, reason="plan created")
            new_version = task.plan_version + 1
            # Supersede unfinished steps of the previous plan version.
            for old in await task_repo.current_steps(s, task, lock=True):
                if StepStatus(old.status) not in STEP_TERMINAL:
                    if old.status in (StepStatus.PENDING.value, StepStatus.WAITING_APPROVAL.value,
                                      StepStatus.WAITING_INPUT.value, StepStatus.BLOCKED.value):
                        transition_step(old, StepStatus.SKIPPED if old.status != StepStatus.WAITING_APPROVAL.value
                                        else StepStatus.CANCELLED)
                        old.error_message = "Superseded by a new plan."
            from app.approvals.service import cancel_for_task

            await cancel_for_task(s, task, reason="superseded by a new plan")

            by_key: dict[str, TaskStep] = {}
            for v in validation.steps:
                st = v.step
                step = TaskStep(
                    tenant_id=task.tenant_id, task_id=task.id, plan_version=new_version, step_key=st.step_id,
                    position=v.order, action=st.action, tool_name=v.tool.spec.name, tool_version=v.tool.spec.version,
                    arguments=st.arguments, permission_level=v.decision.permission_level.value,
                    risk_level=v.decision.risk_level.value,
                    requires_approval=v.decision.decision == Decision.REQUIRE_APPROVAL,
                    policy_reasons=v.decision.reasons, expected_result=st.expected_result,
                    verification_method=v.tool.spec.verification_method,
                    timeout_seconds=float(min(st.timeout_seconds or v.tool.spec.timeout_seconds,
                                              v.tool.spec.timeout_seconds * 2)),
                    retry_policy=(st.retry_policy.model_dump() if st.retry_policy
                                  else v.tool.spec.retry_policy.model_dump()),
                    max_attempts=(st.retry_policy.max_attempts if st.retry_policy
                                  else v.tool.spec.retry_policy.max_attempts),
                    idempotency_key=stable_hash(task.id, new_version, st.step_id)[:64],
                )
                s.add(step)
                by_key[st.step_id] = step
            await s.flush()
            for v in validation.steps:
                for dep in v.step.dependencies:
                    if dep in by_key:
                        s.add(TaskDependency(tenant_id=task.tenant_id, task_id=task.id,
                                             step_id=by_key[v.step.step_id].id,
                                             depends_on_step_id=by_key[dep].id))
            task.plan_version = new_version
            task.plan = {
                "goal": plan.goal,
                "summary": plan.summary,
                "steps": [v.step.model_dump(mode="json") for v in validation.steps],
                "dependencies": {v.step.step_id: v.step.dependencies for v in validation.steps},
                "model_labels": {v.step.step_id: {"requires_approval": v.step.requires_approval,
                                                  "risk_level": v.step.risk_level.value} for v in validation.steps},
                "direct_response": plan.direct_response,
                "tool_versions": {v.step.step_id: v.tool.spec.key for v in validation.steps},
                "planned_at": utcnow().isoformat(),
            }
            exec_meta = dict(task.execution_metadata or {})
            exec_meta.update({"planner": meta, "agent": inputs.agent_label, "policy_version": inputs.policy.policy_version,
                              "strategy_version": inputs.strategy_version})
            if inputs.saw_untrusted:
                exec_meta["planner_saw_untrusted"] = True
            exec_meta.pop("replan_reason", None)
            task.execution_metadata = exec_meta
            task.policy_version = inputs.policy.policy_version
            task.strategy_version = inputs.strategy_version
            task.pending_questions = None
            await append_event(s, task, EventType.PLAN_CREATED,
                               payload={"plan_version": new_version, "steps": len(validation.steps),
                                        "summary": plan.summary[:500]})
            await transition_task(s, task, TaskStatus.VALIDATING, reason="validating plan")
            await append_event(s, task, EventType.PLAN_VALIDATED,
                               payload={"plan_version": new_version,
                                        "approvals_expected": sum(1 for v in validation.steps
                                                                  if v.decision.decision == Decision.REQUIRE_APPROVAL)})
            await transition_task(s, task, TaskStatus.QUEUED, reason="plan validated")
            await self.queue.enqueue(s, JobSpec(queue=Queues.EXECUTION, job_type="task.execute",
                                                payload={"task_id": str(task.id), "tenant_id": str(task.tenant_id)},
                                                dedupe_key=f"task:{task.id}", tenant_id=task.tenant_id,
                                                priority=task.priority))
            audit.record(s, category=AuditCategory.TASK, action="task.planned", tenant_id=task.tenant_id,
                         user_id=task.user_id, actor_type="worker", task_id=task.id,
                         metadata={"plan_version": new_version, "steps": len(validation.steps),
                                   "model": meta.get("model")})
            await s.commit()
            return task.status

    async def _reject(self, s: AsyncSession, task: Task, issues: list[PlanIssue]) -> None:
        await append_event(s, task, EventType.PLAN_REJECTED, payload={"issues": issues_as_feedback(issues)[:20]})
        denied = [i for i in issues if i.code == "permission_denied"]
        task.failure_code = "policy_denied" if denied else "plan_invalid"
        task.failure_message = ("The request needs actions that are not permitted: " + "; ".join(
            i.message for i in denied)[:1500]) if denied else (
            "A valid plan could not be produced: " + "; ".join(i.message for i in issues[:5])[:1500])
        target = TaskStatus.BLOCKED if denied else TaskStatus.FAILED
        await transition_task(s, task, target, reason=task.failure_code)
        from app.execution.summary import build_summary

        task.result_summary = await build_summary(s, task)

    async def _finish_failed(self, task_id: uuid.UUID, tenant_id: uuid.UUID, code: str, message: str) -> None:
        async with self.sf() as s:
            s.info["tenant_id"] = tenant_id
            task = await task_repo.lock_task(s, task_id)
            if TaskStatus(task.status) in (TaskStatus.COMPLETED, TaskStatus.CANCELLED, TaskStatus.FAILED):
                await s.commit()
                return
            task.failure_code, task.failure_message = code, message
            if task.status == TaskStatus.CREATED.value:
                await transition_task(s, task, TaskStatus.PLANNING, reason="planning")
            await transition_task(s, task, TaskStatus.FAILED, reason=code)
            from app.execution.summary import build_summary

            task.result_summary = await build_summary(s, task)
            from app.notifications.service import NotificationEvent, notify

            await notify(s, tenant_id=task.tenant_id, user_id=task.user_id, event=NotificationEvent.TASK_FAILED,
                         title="Task could not be planned", body=message, data={"task_id": str(task.id)},
                         idempotency_key=f"plan-failed:{task.id}:{task.event_seq}")
            await s.commit()
