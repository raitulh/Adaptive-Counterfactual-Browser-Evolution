from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from browser_testkit import executor_settings

from app.browser.tools import TOOLS, BrowserTool, RunIn
from app.common.context import RequestContext
from app.common.enums import PermissionLevel, RiskLevel, TrustLevel, VerificationStatus
from app.organizations.schemas import OrganizationPolicy
from app.tools.base import ToolContext, ToolResult
from app.tools.registry import ToolRegistry
from app.verification.types import VerificationMethod

BY_NAME: dict[str, BrowserTool] = {t.spec.name: t for t in TOOLS}  # type: ignore[misc]


def _tctx(org_policy: OrganizationPolicy | None = None, **settings: Any) -> ToolContext:
    ctx = RequestContext(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="owner", permissions=frozenset())
    services: Any = SimpleNamespace(settings=executor_settings(**settings), session_factory=None, storage=None)
    return ToolContext(ctx=ctx, task_id=uuid.uuid4(), step_id=uuid.uuid4(), step_key="s1", attempt_number=1,
                       idempotency_key="k", services=services, org_policy=org_policy or OrganizationPolicy())


def _obs(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "browser_task_id": str(uuid.uuid4()), "status": "succeeded", "final_url": "https://example.com/done",
        "final_url_allowed": True, "title": "Done", "extracts": [], "screenshots": [], "checks": [],
        "action_log": [], "actions_executed": 2,
    }
    base.update(overrides)
    return base


def test_tool_specs() -> None:
    assert set(BY_NAME) == {"browser.navigate", "browser.extract", "browser.screenshot", "browser.click",
                            "browser.fill", "browser.run"}
    for tool in TOOLS:
        spec = tool.spec
        assert spec.category == "browser" and spec.provider == "browser"
        assert spec.async_execution
        assert spec.output_trust == TrustLevel.UNTRUSTED_EXTERNAL_CONTENT
        assert spec.verification_method == VerificationMethod.BROWSER_STATE
        assert spec.input_schema and spec.output_schema
    for name in ("browser.navigate", "browser.extract", "browser.screenshot", "browser.run"):
        assert BY_NAME[name].spec.permission_level == PermissionLevel.READ
    for name in ("browser.click", "browser.fill"):
        spec = BY_NAME[name].spec
        assert spec.permission_level == PermissionLevel.WRITE
        assert spec.risk_level == RiskLevel.HIGH
        assert spec.requires_approval


def test_tools_register_cleanly() -> None:
    registry = ToolRegistry()
    for tool in TOOLS:
        registry.register(tool)
    assert registry.has("browser.run")


def test_run_assessment_escalates_only_for_interactive_actions() -> None:
    tool = BY_NAME["browser.run"]
    reads = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"},
                                         {"type": "extract", "mode": "aria"}]})
    assessment = tool.assess(reads, OrganizationPolicy())
    assert assessment.permission_level == PermissionLevel.READ and not assessment.requires_approval
    writes = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"},
                                          {"type": "click", "target": {"text": "Buy"}}]})
    assessment = tool.assess(writes, OrganizationPolicy())
    assert assessment.permission_level == PermissionLevel.WRITE
    assert assessment.risk_level == RiskLevel.HIGH
    assert assessment.requires_approval


def test_input_validation() -> None:
    with pytest.raises(ValueError, match="navigate"):
        RunIn.model_validate({"actions": [{"type": "extract"}]})
    with pytest.raises(ValueError):
        BY_NAME["browser.navigate"].parse_args({"url": "file:///etc/passwd"})
    with pytest.raises(ValueError):
        BY_NAME["browser.click"].parse_args({"url": "https://example.com", "target": {"text": "x"}, "extra": 1})
    fill = BY_NAME["browser.fill"].parse_args({"url": "https://example.com/login", "target": {"label": "Email"},
                                               "value": "me@example.com", "submit": True})
    assert [a.type for a in BY_NAME["browser.fill"].build_actions(fill)] == ["navigate", "fill", "press"]
    description = BY_NAME["browser.fill"].describe(fill)
    assert "me@example.com" not in description and "example.com" in description
    assert BY_NAME["browser.fill"].target(fill) == "web:example.com"


async def test_verify_read_passes_on_evidence() -> None:
    tool = BY_NAME["browser.extract"]
    args = tool.parse_args({"url": "https://example.com", "mode": "text"})
    extract = {"index": 1, "mode": "text", "content": "Hello", "chars": 5}
    outcome = await tool.verify(_tctx(), args, ToolResult(output=_obs(extracts=[extract]), summary=""))
    assert outcome.status == VerificationStatus.PASSED
    assert outcome.method == VerificationMethod.BROWSER_STATE


async def test_verify_read_fails_on_empty_extract_or_bad_state() -> None:
    tool = BY_NAME["browser.extract"]
    args = tool.parse_args({"url": "https://example.com"})
    empty = {"index": 1, "mode": "text", "content": "", "chars": 0}
    outcome = await tool.verify(_tctx(), args, ToolResult(output=_obs(extracts=[empty]), summary=""))
    assert outcome.status == VerificationStatus.FAILED
    assert {d.field for d in outcome.differences} == {"extracts"}
    outcome = await tool.verify(_tctx(), args, ToolResult(output={"browser_task_id": "x"}, summary=""))
    assert outcome.status == VerificationStatus.FAILED
    outcome = await tool.verify(_tctx(), args, ToolResult(output={"not": "observations"}, summary=""))
    assert outcome.status == VerificationStatus.FAILED


async def test_verify_requires_final_url_on_allowed_domain() -> None:
    tool = BY_NAME["browser.navigate"]
    args = tool.parse_args({"url": "https://example.com"})
    ok = await tool.verify(_tctx(), args, ToolResult(output=_obs(actions_executed=1), summary=""))
    assert ok.passed
    denied = await tool.verify(_tctx(OrganizationPolicy(browser_denied_domains=["example.com"])), args,
                               ToolResult(output=_obs(actions_executed=1), summary=""))
    assert not denied.passed and denied.differences[0].field == "final_url"
    flagged = await tool.verify(_tctx(), args, ToolResult(output=_obs(actions_executed=1, final_url_allowed=False),
                                                          summary=""))
    assert not flagged.passed


async def test_verify_side_effects_need_concrete_evidence() -> None:
    tool = BY_NAME["browser.click"]
    plain = tool.parse_args({"url": "https://example.com", "target": {"role": "button", "name": "Save"}})
    outcome = await tool.verify(_tctx(), plain, ToolResult(output=_obs(), summary=""))
    assert outcome.status == VerificationStatus.INCONCLUSIVE

    expecting = tool.parse_args({"url": "https://example.com", "target": {"role": "button", "name": "Save"},
                                 "expect_text": "Saved", "expect_url_contains": "/done"})
    checks = [{"kind": "text", "expected": "Saved", "satisfied": True},
              {"kind": "url_contains", "expected": "/done", "satisfied": True, "observed": "https://example.com/done"}]
    passed = await tool.verify(_tctx(), expecting, ToolResult(output=_obs(checks=checks), summary=""))
    assert passed.status == VerificationStatus.PASSED

    unmet = [dict(checks[0], satisfied=False), checks[1]]
    failed = await tool.verify(_tctx(), expecting, ToolResult(output=_obs(checks=unmet), summary=""))
    assert failed.status == VerificationStatus.FAILED
    assert [d.field for d in failed.differences] == ["expect_text"]

    # Evidence must be for *these* expectations, not whatever the page reported.
    other = [dict(checks[0], expected="Something else"), checks[1]]
    mismatch = await tool.verify(_tctx(), expecting, ToolResult(output=_obs(checks=other), summary=""))
    assert mismatch.status == VerificationStatus.FAILED


async def test_verify_run_without_side_effects_passes_and_with_them_is_inconclusive() -> None:
    tool = BY_NAME["browser.run"]
    read = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"},
                                        {"type": "screenshot"}]})
    no_shot = await tool.verify(_tctx(), read, ToolResult(output=_obs(), summary=""))
    assert no_shot.status == VerificationStatus.FAILED
    shot = await tool.verify(_tctx(), read, ToolResult(output=_obs(screenshots=["k"]), summary=""))
    assert shot.passed
    write = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"},
                                         {"type": "fill", "target": {"label": "Name"}, "value": "x"}]})
    outcome = await tool.verify(_tctx(), write, ToolResult(output=_obs(), summary=""))
    assert outcome.status == VerificationStatus.INCONCLUSIVE
    failed_step = await tool.verify(_tctx(), write, ToolResult(output=_obs(action_log=[
        {"index": 1, "type": "fill", "status": "error", "duration_ms": 1}]), summary=""))
    assert failed_step.status == VerificationStatus.FAILED
