from __future__ import annotations

import uuid

import pytest

from app.agents.schemas import ToolPolicy
from app.common.context import RequestContext
from app.common.enums import PermissionLevel, RiskLevel
from app.organizations.rbac import ROLE_PERMISSIONS
from app.organizations.schemas import OrganizationPolicy
from app.permissions.service import Decision, PermissionService, PolicyInputs, ToolRule
from app.tools.base import RiskAssessment, ToolSpec


def ctx(role: str = "member") -> RequestContext:
    return RequestContext(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), role=role,
                          permissions=frozenset(ROLE_PERMISSIONS[role]))


def spec(name: str, level: PermissionLevel, risk: RiskLevel = RiskLevel.LOW, approval: bool = False,
         category: str = "email") -> ToolSpec:
    return ToolSpec(name=name, description="d", category=category, permission_level=level, risk_level=risk,
                    requires_approval=approval)


def inputs(**policy_kwargs: object) -> PolicyInputs:
    rules = policy_kwargs.pop("rules", [])
    allowed = policy_kwargs.pop("allowed", ["*"])
    return PolicyInputs(org_policy=OrganizationPolicy(**policy_kwargs), policy_version=1, tool_rules=rules,  # type: ignore[arg-type]
                        agent_tool_policy=ToolPolicy(allowed=allowed), flags={})  # type: ignore[arg-type]


engine = PermissionService()


def test_reads_are_allowed() -> None:
    d = engine.evaluate(ctx(), spec("calendar.list_events", PermissionLevel.READ), inputs())
    assert d.decision == Decision.ALLOW


def test_viewer_cannot_run_agent_actions() -> None:
    d = engine.evaluate(ctx("viewer"), spec("calendar.list_events", PermissionLevel.READ), inputs())
    assert d.decision == Decision.DENY


def test_high_risk_write_requires_approval() -> None:
    d = engine.evaluate(ctx(), spec("gmail.send", PermissionLevel.HIGH_RISK_WRITE, RiskLevel.HIGH), inputs())
    assert d.decision == Decision.REQUIRE_APPROVAL


def test_destructive_denied_unless_org_opts_in_and_then_needs_approval() -> None:
    s = spec("drive.delete", PermissionLevel.DESTRUCTIVE, RiskLevel.HIGH)
    assert engine.evaluate(ctx(), s, inputs()).decision == Decision.DENY
    assert engine.evaluate(ctx(), s, inputs(allow_destructive_actions=True)).decision == Decision.REQUIRE_APPROVAL


def test_financial_and_admin_actions() -> None:
    assert engine.evaluate(ctx(), spec("pay.send", PermissionLevel.FINANCIAL), inputs()).decision == Decision.DENY
    assert engine.evaluate(ctx("owner"), spec("org.delete", PermissionLevel.ADMIN),
                           inputs()).decision == Decision.DENY


def test_org_blocklist_and_agent_policy() -> None:
    s = spec("gmail.search", PermissionLevel.READ)
    assert engine.evaluate(ctx(), s, inputs(blocked_tools=["gmail.*"])).decision == Decision.DENY
    assert engine.evaluate(ctx(), s, inputs(allowed=["calendar.*"])).decision == Decision.DENY


def test_assessment_can_only_escalate() -> None:
    s = spec("calendar.create_event", PermissionLevel.WRITE, RiskLevel.MEDIUM)
    lower = RiskAssessment(permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW, requires_approval=False)
    d = engine.evaluate(ctx(), s, inputs(), assessment=lower)
    assert d.permission_level == PermissionLevel.WRITE and d.risk_level == RiskLevel.MEDIUM
    higher = RiskAssessment(permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.HIGH,
                            requires_approval=True, reasons=["external attendees"])
    d = engine.evaluate(ctx(), s, inputs(), assessment=higher)
    assert d.decision == Decision.REQUIRE_APPROVAL and "external attendees" in d.reasons


def test_model_claim_escalates_but_never_relaxes() -> None:
    s = spec("calendar.create_event", PermissionLevel.WRITE, RiskLevel.MEDIUM)
    assert engine.evaluate(ctx(), s, inputs(), model_requested_approval=True).decision == Decision.REQUIRE_APPROVAL
    s2 = spec("gmail.send", PermissionLevel.HIGH_RISK_WRITE, RiskLevel.HIGH)
    assert engine.evaluate(ctx(), s2, inputs(), model_requested_approval=False).decision == Decision.REQUIRE_APPROVAL


def test_allow_rule_waives_only_bounded_writes_and_never_tainted_ones() -> None:
    s = spec("gmail.send", PermissionLevel.HIGH_RISK_WRITE, RiskLevel.MEDIUM)
    rules = [ToolRule("gmail.send", None, "allow")]
    medium = RiskAssessment(permission_level=PermissionLevel.HIGH_RISK_WRITE, risk_level=RiskLevel.MEDIUM,
                            requires_approval=True)
    assert engine.evaluate(ctx(), s, inputs(rules=rules), assessment=medium).decision == Decision.ALLOW
    tainted = engine.evaluate(ctx(), s, inputs(rules=rules), assessment=medium, tainted_by_untrusted=True)
    assert tainted.decision == Decision.REQUIRE_APPROVAL
    high = RiskAssessment(permission_level=PermissionLevel.HIGH_RISK_WRITE, risk_level=RiskLevel.HIGH,
                          requires_approval=True)
    assert engine.evaluate(ctx(), s, inputs(rules=rules), assessment=high).decision == Decision.REQUIRE_APPROVAL


def test_deny_rule_and_role_specific_rules() -> None:
    s = spec("calendar.list_events", PermissionLevel.READ)
    assert engine.evaluate(ctx(), s, inputs(rules=[ToolRule("calendar.*", "member", "deny")])).decision \
        == Decision.DENY
    assert engine.evaluate(ctx("admin"), s, inputs(rules=[ToolRule("calendar.*", "member", "deny")])).decision \
        == Decision.ALLOW
    # An organization may insist on approval even for a read.
    assert engine.evaluate(ctx(), s, inputs(always_require_approval=["calendar.list_events"])).decision \
        == Decision.REQUIRE_APPROVAL
    w = spec("calendar.create_event", PermissionLevel.WRITE, RiskLevel.MEDIUM)
    assert engine.evaluate(ctx(), w, inputs(always_require_approval=["calendar.*"])).decision \
        == Decision.REQUIRE_APPROVAL


@pytest.mark.parametrize("flag_category", ["browser", "mcp", "search"])
def test_feature_flags_gate_categories(flag_category: str) -> None:
    from app.permissions.service import _FLAG_BY_CATEGORY

    s = spec(f"{flag_category}.x", PermissionLevel.READ, category=flag_category)
    pol = inputs()
    pol.flags = {_FLAG_BY_CATEGORY[flag_category]: False}
    assert engine.evaluate(ctx(), s, pol).decision == Decision.DENY
