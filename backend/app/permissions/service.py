"""Permission & policy engine.

Decides — without consulting any model output — whether a tool action may run
for a principal: ``ALLOW``, ``REQUIRE_APPROVAL`` or ``DENY``, with reasons.
Inputs: the user's role/permissions, organization policy and tool rules, the
agent version's tool policy, the tool's static spec, the argument-dependent
risk assessment, feature flags and data taint. The model's own
``requires_approval`` claim can only *escalate* the decision, never relax it.
"""

from __future__ import annotations

import fnmatch
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.schemas import ToolPolicy
from app.common.context import RequestContext
from app.common.enums import PermissionLevel, RiskLevel, StrEnum
from app.common.feature_flags import Flags, is_enabled
from app.organizations.rbac import P
from app.organizations.schemas import OrganizationPolicy
from app.tools.base import RiskAssessment, ToolSpec
from app.tools.models import ToolPermission


class Decision(StrEnum):
    ALLOW = "allow"
    REQUIRE_APPROVAL = "require_approval"
    DENY = "deny"


@dataclass(slots=True)
class PolicyDecision:
    decision: Decision
    permission_level: PermissionLevel
    risk_level: RiskLevel
    reasons: list[str] = field(default_factory=list)

    @property
    def allowed(self) -> bool:
        return self.decision != Decision.DENY

    @property
    def needs_approval(self) -> bool:
        return self.decision == Decision.REQUIRE_APPROVAL


@dataclass(slots=True)
class ToolRule:
    tool_pattern: str
    role: str | None
    effect: str  # deny | require_approval | allow
    reason: str | None = None


@dataclass(slots=True)
class PolicyInputs:
    """Everything the engine needs, loaded once per task execution."""

    org_policy: OrganizationPolicy
    policy_version: int
    tool_rules: list[ToolRule]
    agent_tool_policy: ToolPolicy
    flags: dict[str, bool]


_FLAG_BY_CATEGORY = {"browser": Flags.BROWSER_AGENT, "mcp": Flags.MCP, "search": Flags.WEB_SEARCH}


async def load_policy_inputs(session: AsyncSession, tenant_id: uuid.UUID, agent_tool_policy: ToolPolicy
                             ) -> PolicyInputs:
    from app.organizations.service import get_policy

    org_policy, version = await get_policy(session, tenant_id)
    rules = (await session.execute(select(ToolPermission).where(ToolPermission.tenant_id == tenant_id))).scalars()
    flags = {flag: await is_enabled(session, flag, tenant_id) for flag in set(_FLAG_BY_CATEGORY.values())}
    return PolicyInputs(
        org_policy=org_policy, policy_version=version,
        tool_rules=[ToolRule(r.tool_pattern, r.role, r.effect, r.reason) for r in rules],
        agent_tool_policy=agent_tool_policy, flags=flags,
    )


def _match(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)


class PermissionService:
    """Pure decision logic (no I/O) so it is exhaustively unit-testable."""

    def evaluate(
        self,
        ctx: RequestContext,
        spec: ToolSpec,
        inputs: PolicyInputs,
        *,
        assessment: RiskAssessment | None = None,
        model_requested_approval: bool = False,
        tainted_by_untrusted: bool = False,
    ) -> PolicyDecision:
        level = spec.permission_level
        risk = spec.risk_level
        needs_approval = spec.requires_approval
        reasons: list[str] = []
        if assessment is not None:
            # Assessments may only escalate the static spec.
            if assessment.permission_level.rank > level.rank:
                level = assessment.permission_level
            risk = RiskLevel.max(risk, assessment.risk_level)
            needs_approval = needs_approval or assessment.requires_approval
            reasons.extend(assessment.reasons)

        def deny(reason: str) -> PolicyDecision:
            return PolicyDecision(Decision.DENY, level, risk, [*reasons, reason])

        # 1. Principal must be allowed to run agent actions at all.
        if not ctx.has(P.TASKS_CREATE):
            return deny("role may not run agent actions")
        # 2. Agents never perform administrative actions.
        if level == PermissionLevel.ADMIN:
            return deny("administrative actions are not available to agents")
        # 3. Feature flags per tool category.
        flag = _FLAG_BY_CATEGORY.get(spec.category)
        if flag is not None and not inputs.flags.get(flag, True):
            return deny(f"feature '{flag}' is disabled for this organization")
        if spec.feature_flag and not inputs.flags.get(spec.feature_flag, True):
            return deny(f"feature '{spec.feature_flag}' is disabled")
        # 4. Organization blocklist and agent tool policy.
        if _match(spec.name, inputs.org_policy.blocked_tools):
            return deny("tool is blocked by organization policy")
        if not _match(spec.name, inputs.agent_tool_policy.allowed) or _match(spec.name,
                                                                             inputs.agent_tool_policy.denied):
            return deny("tool is not allowed for this agent")
        # 5. Destructive / financial actions require explicit organization opt-in.
        if level == PermissionLevel.DESTRUCTIVE:
            if not inputs.org_policy.allow_destructive_actions:
                return deny("destructive actions are disabled by organization policy")
            needs_approval = True
            reasons.append("destructive action")
        if level == PermissionLevel.FINANCIAL:
            if not inputs.org_policy.allow_financial_actions:
                return deny("financial actions are disabled by organization policy")
            needs_approval = True
            reasons.append("financial action")
        # 6. Default approval requirements by level and risk.
        if level == PermissionLevel.HIGH_RISK_WRITE:
            needs_approval = True
        if level.has_side_effects and risk.rank >= RiskLevel.HIGH.rank:
            needs_approval = True
            reasons.append(f"{risk.value} risk")
        # 7. Organization tool rules (role-specific rules first).
        applicable = [r for r in inputs.tool_rules
                      if fnmatch.fnmatchcase(spec.name, r.tool_pattern) and (r.role is None or r.role == ctx.role)]
        applicable.sort(key=lambda r: (r.role is None, r.effect != "deny"))
        for rule in applicable:
            if rule.effect == "deny":
                return deny(rule.reason or f"denied by organization rule '{rule.tool_pattern}'")
        if any(r.effect == "require_approval" for r in applicable) or \
                _match(spec.name, inputs.org_policy.always_require_approval):
            needs_approval = True
            reasons.append("organization requires approval for this tool")
        elif any(r.effect == "allow" for r in applicable) and needs_approval:
            # "allow" may waive the default approval only for bounded, non-destructive writes.
            if level in (PermissionLevel.WRITE, PermissionLevel.HIGH_RISK_WRITE) and risk.rank <= RiskLevel.MEDIUM.rank \
                    and not tainted_by_untrusted and not model_requested_approval:
                needs_approval = False
                reasons.append("approval waived by organization rule")
        # 8. Data provenance: arguments derived from untrusted content cannot trigger unattended side effects.
        if tainted_by_untrusted and level.has_side_effects:
            needs_approval = True
            reasons.append("arguments derived from untrusted external content")
        # 9. The model may ask for approval (escalation only).
        if model_requested_approval and level.has_side_effects:
            needs_approval = True
        return PolicyDecision(Decision.REQUIRE_APPROVAL if needs_approval else Decision.ALLOW, level, risk,
                              list(dict.fromkeys(reasons)))


def describe_decision(decision: PolicyDecision) -> dict[str, Any]:
    return {"decision": decision.decision.value, "permission_level": decision.permission_level.value,
            "risk_level": decision.risk_level.value, "reasons": decision.reasons}
