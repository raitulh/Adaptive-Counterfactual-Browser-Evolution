"""PlanValidator: nothing the model proposes runs until it passes every check here.

Plan → schema validation → tool validation → dependency (DAG) validation →
reference validation → literal-argument validation → limits → permission check
→ policy check → risk analysis. Issues are returned as structured, repairable
errors so the planner can re-plan with precise feedback.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Any

import jsonschema
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.schemas import ResolvedAgent
from app.common.context import RequestContext
from app.core.config import get_settings
from app.core.exceptions import ToolNotFound
from app.execution.references import (
    UnresolvableReference,
    collect_refs,
    parse_ref,
    ref_paths_valid_for_schema,
    strip_refs_for_static_check,
)
from app.permissions.service import Decision, PermissionService, PolicyDecision, PolicyInputs
from app.planner.schemas import Plan, PlanIssue, PlanStep
from app.tools.base import Tool
from app.tools.registry import ToolResolver


@dataclass(slots=True)
class ValidatedStep:
    step: PlanStep
    tool: Tool[Any, Any]
    decision: PolicyDecision
    order: int


@dataclass(slots=True)
class ValidationResult:
    plan: Plan
    steps: list[ValidatedStep] = field(default_factory=list)
    issues: list[PlanIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues

    @property
    def repairable(self) -> bool:
        return all(i.repairable for i in self.issues)


def topological_order(steps: list[PlanStep]) -> tuple[list[str], list[str]]:
    """Kahn's algorithm. Returns (order, nodes_in_cycles)."""
    ids = [s.step_id for s in steps]
    deps = {s.step_id: [d for d in s.dependencies if d in ids] for s in steps}
    indegree = {sid: len(deps[sid]) for sid in ids}
    dependents: dict[str, list[str]] = {sid: [] for sid in ids}
    for sid, ds in deps.items():
        for d in ds:
            dependents[d].append(sid)
    queue = deque(sid for sid in ids if indegree[sid] == 0)
    order: list[str] = []
    while queue:
        sid = queue.popleft()
        order.append(sid)
        for nxt in dependents[sid]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                queue.append(nxt)
    return order, [sid for sid in ids if indegree[sid] > 0]


def transitive_dependencies(steps: list[PlanStep]) -> dict[str, set[str]]:
    direct = {s.step_id: set(s.dependencies) for s in steps}
    closure: dict[str, set[str]] = {}

    def visit(sid: str, seen: frozenset[str]) -> set[str]:
        if sid in closure:
            return closure[sid]
        acc: set[str] = set()
        for d in direct.get(sid, set()):
            if d in seen:
                continue
            acc |= {d} | visit(d, seen | {d})
        closure[sid] = acc
        return acc

    for s in steps:
        visit(s.step_id, frozenset({s.step_id}))
    return closure


def validate_literal_arguments(tool: Tool[Any, Any], arguments: dict[str, Any]) -> list[str]:
    """Validate literal (non-reference) top-level arguments against the tool's JSON schema.
    Referenced fields are validated with the full model after resolution at execution time."""
    schema = tool.spec.input_schema or {}
    props: dict[str, Any] = schema.get("properties", {})
    required: list[str] = list(schema.get("required", []))
    literal, deferred = strip_refs_for_static_check(arguments)
    problems: list[str] = []
    for name in required:
        if name not in literal and name not in deferred:
            problems.append(f"missing required argument '{name}'")
    if schema.get("additionalProperties") is False:
        for name in arguments:
            if name not in props:
                problems.append(f"unknown argument '{name}'")
    defs = schema.get("$defs", {})
    for name, value in literal.items():
        prop = props.get(name)
        if prop is None:
            continue
        sub = {**prop, "$defs": defs} if defs else prop
        try:
            jsonschema.validate(value, sub, cls=jsonschema.Draft202012Validator)
        except jsonschema.ValidationError as exc:
            problems.append(f"argument '{name}': {exc.message[:200]}")
        except jsonschema.SchemaError:
            continue
    return problems


class PlanValidator:
    def __init__(self, resolver: ToolResolver | None = None, permissions: PermissionService | None = None) -> None:
        self.resolver = resolver or ToolResolver()
        self.permissions = permissions or PermissionService()

    async def validate(self, session: AsyncSession, ctx: RequestContext, plan: Plan, *, agent: ResolvedAgent,
                       policy: PolicyInputs, remaining_tool_calls: int, performed_tools: set[str] | None = None,
                       ) -> ValidationResult:
        settings = get_settings()
        result = ValidationResult(plan=plan)
        issues = result.issues
        max_steps = min(settings.max_plan_steps, agent.execution_limits.max_steps or settings.max_plan_steps)

        if plan.needs_user_input and plan.steps:
            issues.append(PlanIssue(code="mixed_plan", message="Ask questions OR provide steps, not both"))
        if not plan.steps and not plan.needs_user_input and not plan.direct_response:
            issues.append(PlanIssue(code="empty_plan", message="Plan has no steps, questions or direct response"))
        if len(plan.steps) > max_steps:
            issues.append(PlanIssue(code="too_many_steps", message=f"At most {max_steps} steps are allowed"))
        if len(plan.steps) > remaining_tool_calls:
            issues.append(PlanIssue(code="budget_exceeded", repairable=False,
                                    message="Plan exceeds the task's remaining tool-call budget"))

        ids = [s.step_id for s in plan.steps]
        duplicates = {sid for sid in ids if ids.count(sid) > 1}
        for sid in duplicates:
            issues.append(PlanIssue(code="duplicate_step_id", message=f"Duplicate step id '{sid}'", step_id=sid))
        # --- DAG
        id_set = set(ids)
        for s in plan.steps:
            for dep in s.dependencies:
                if dep == s.step_id:
                    issues.append(PlanIssue(code="self_dependency", step_id=s.step_id,
                                            message="A step cannot depend on itself"))
                elif dep not in id_set:
                    issues.append(PlanIssue(code="unknown_dependency", step_id=s.step_id,
                                            message=f"Unknown dependency '{dep}'"))
        order, cyclic = topological_order(plan.steps)
        if cyclic:
            issues.append(PlanIssue(code="dependency_cycle", message=f"Dependency cycle among {sorted(cyclic)}"))
        closure = transitive_dependencies(plan.steps)

        # --- tools, references, arguments, policy
        by_id = {s.step_id: s for s in plan.steps}
        tools: dict[str, Tool[Any, Any]] = {}
        browser_steps = 0
        for s in plan.steps:
            try:
                tool = await self.resolver.resolve(session, ctx.tenant_id, s.tool, s.tool_version)
            except ToolNotFound:
                issues.append(PlanIssue(code="unknown_tool", step_id=s.step_id, message=f"Unknown tool '{s.tool}'"))
                continue
            tools[s.step_id] = tool
            if performed_tools and tool.spec.name in performed_tools and tool.spec.has_side_effects:
                # A re-plan must not repeat an action that already took effect (e.g. book a second meeting
                # because the first one now occupies the slot): reuse its recorded result or ask the user.
                issues.append(PlanIssue(code="repeats_performed_action", step_id=s.step_id,
                                        message=f"'{s.tool}' was already performed for this task; use the recorded "
                                                "result instead of repeating it, or ask the user"))
            if tool.spec.category == "browser":
                browser_steps += 1
            try:
                refs = collect_refs(s.arguments)
            except UnresolvableReference as exc:
                issues.append(PlanIssue(code="malformed_reference", step_id=s.step_id, message=exc.message))
                refs = set()
            for ref_step in refs:
                if ref_step not in by_id:
                    issues.append(PlanIssue(code="unknown_reference", step_id=s.step_id,
                                            message=f"References unknown step '{ref_step}'"))
                elif ref_step not in closure.get(s.step_id, set()):
                    issues.append(PlanIssue(code="reference_not_dependency", step_id=s.step_id,
                                            message=f"References '{ref_step}' which is not in its dependencies"))
            for problem in validate_literal_arguments(tool, s.arguments):
                issues.append(PlanIssue(code="invalid_arguments", step_id=s.step_id, message=problem))

        output_schemas = {sid: t.spec.output_schema for sid, t in tools.items()}
        for s in plan.steps:
            if s.step_id in tools:
                try:
                    for problem in ref_paths_valid_for_schema(s.arguments, output_schemas):
                        issues.append(PlanIssue(code="invalid_reference_path", step_id=s.step_id, message=problem))
                except UnresolvableReference as exc:
                    issues.append(PlanIssue(code="malformed_reference", step_id=s.step_id, message=exc.message))

        if browser_steps and browser_steps > (agent.execution_limits.max_browser_actions
                                              or settings.max_browser_actions_per_task):
            issues.append(PlanIssue(code="too_many_browser_steps", message="Browser action limit exceeded"))

        position = {sid: i for i, sid in enumerate(order)}
        for s in plan.steps:
            resolved_tool = tools.get(s.step_id)
            if resolved_tool is None:
                continue
            tool = resolved_tool
            decision = self._static_decision(ctx, tool, s, policy)
            if decision.decision == Decision.DENY:
                issues.append(PlanIssue(code="permission_denied", step_id=s.step_id,
                                        message=f"'{s.tool}' is not permitted: {'; '.join(decision.reasons)}"))
                continue
            result.steps.append(ValidatedStep(step=s, tool=tool, decision=decision,
                                              order=position.get(s.step_id, len(order))))
        result.steps.sort(key=lambda v: v.order)
        return result

    def _static_decision(self, ctx: RequestContext, tool: Tool[Any, Any], step: PlanStep, policy: PolicyInputs
                         ) -> PolicyDecision:
        assessment = None
        literal, deferred = strip_refs_for_static_check(step.arguments)
        if not deferred:
            try:
                args = tool.parse_args(literal)
                assessment = tool.assess(args, policy.org_policy)
            except Exception:  # full validation happens at execution; static check is best-effort
                assessment = None
        decision = self.permissions.evaluate(ctx, tool.spec, policy, assessment=assessment,
                                             model_requested_approval=step.requires_approval)
        # The model's own risk label may escalate the recorded risk, never lower it.
        if step.risk_level.rank > decision.risk_level.rank and decision.permission_level.has_side_effects:
            decision.risk_level = step.risk_level
        return decision


def issues_as_feedback(issues: list[PlanIssue]) -> list[dict[str, Any]]:
    return [i.model_dump(exclude_none=True) for i in issues]


def references_in(step: PlanStep) -> set[str]:
    try:
        return collect_refs(step.arguments)
    except UnresolvableReference:
        return set()


__all__ = ["PlanValidator", "ValidatedStep", "ValidationResult", "issues_as_feedback", "parse_ref",
           "references_in", "topological_order", "transitive_dependencies", "validate_literal_arguments"]
