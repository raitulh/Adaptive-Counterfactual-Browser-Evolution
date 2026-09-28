"""browser tool ``execute``: validation, policy, flag, rate limit and idempotent dispatch."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from browser_itkit import World, tool_context
from browser_testkit import executor_settings
from sqlalchemy import func, select

from app.audit.models import AuditLog
from app.browser.models import BrowserTask, BrowserTaskStatus
from app.browser.tools import TOOLS
from app.common import feature_flags
from app.common.enums import ErrorClass
from app.common.feature_flags import Flags
from app.common.models import FeatureFlag
from app.core.database import get_session_factory
from app.core.exceptions import FeatureDisabled, NeedsUserInput, RateLimited, ToolInputInvalid, UnsafeURL
from app.organizations.schemas import OrganizationPolicy
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration

TOOL = {t.spec.name: t for t in TOOLS}
PUBLIC = {"example.com": "93.184.215.14", "www.example.com": "93.184.215.14", "intranet.example": "10.2.3.4"}


async def _browser_tasks(world: World) -> list[BrowserTask]:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        return list((await s.execute(select(BrowserTask).where(BrowserTask.task_id == world.task_id)
                                     .order_by(BrowserTask.created_at))).scalars().all())


async def _pending_jobs(browser_task_id: Any) -> int:
    async with get_session_factory()() as s:
        s.info["system"] = True
        return int((await s.execute(select(func.count()).select_from(Job).where(
            Job.queue == "browser", Job.job_type == "browser.run", Job.status == "pending",
            Job.dedupe_key == f"browser:{browser_task_id}"))).scalar_one())


async def test_execute_dispatches_idempotently(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.extract", status="running")
    tool = TOOL["browser.extract"]
    args = tool.parse_args({"url": "https://example.com/docs", "mode": "aria"})
    tctx = tool_context(world, step, strategy={"browser_locator_order": ["css", "role"]})
    first = await tool.execute(tctx, args)
    second = await tool.execute(tctx, args)
    assert first.pending_external and second.pending_external
    assert first.output == second.output
    assert first.external_ref == first.output["browser_task_id"]
    (task,) = await _browser_tasks(world)
    assert str(task.id) == first.external_ref
    assert task.status == BrowserTaskStatus.QUEUED
    assert task.idempotency_key == step.idempotency_key
    assert task.user_id == world.user_id
    assert [a["type"] for a in task.actions] == ["navigate", "extract"]
    assert task.options["locator_order"][:2] == ["css", "role"]
    assert task.options["side_effects"] is False
    assert await _pending_jobs(task.id) == 1


async def test_execute_rejects_disallowed_urls_before_queueing(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.navigate", status="running")
    tool = TOOL["browser.navigate"]
    for url in ("http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.8/",
                "https://intranet.example/"):
        with pytest.raises(UnsafeURL) as exc:
            await tool.execute(tool_context(world, step), tool.parse_args({"url": url}))
        assert exc.value.error_class == ErrorClass.POLICY_BLOCKED
    org = OrganizationPolicy(browser_allowed_domains=["docs.example.org"])
    with pytest.raises(UnsafeURL):
        await tool.execute(tool_context(world, step, org_policy=org), tool.parse_args({"url": "https://example.com"}))
    assert await _browser_tasks(world) == []


async def test_execute_respects_kill_switches(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.navigate", status="running")
    tool = TOOL["browser.navigate"]
    args = tool.parse_args({"url": "https://example.com"})
    with pytest.raises(FeatureDisabled):
        await tool.execute(tool_context(world, step, settings=executor_settings(browser_enabled=False)), args)
    async with get_session_factory()() as s:
        s.info["system"] = True
        s.add(FeatureFlag(key=Flags.BROWSER_AGENT, tenant_id=world.tenant_id, enabled=False))
        await s.commit()
    feature_flags.clear_cache()
    try:
        with pytest.raises(FeatureDisabled):
            await tool.execute(tool_context(world, step), args)
    finally:
        feature_flags.clear_cache()
    assert await _browser_tasks(world) == []


async def test_execute_enforces_action_budget_and_launch_rate(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.run", status="running")
    tool = TOOL["browser.run"]
    many = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"}]
                            + [{"type": "extract"}] * 5})
    with pytest.raises(ToolInputInvalid):
        await tool.execute(tool_context(world, step, settings=executor_settings(browser_max_actions=3)), many)
    limited = executor_settings(rate_limit_browser_launch_per_minute=2)
    args = TOOL["browser.navigate"].parse_args({"url": "https://example.com"})
    nav_step = await make_step("browser.navigate", status="running")
    await TOOL["browser.navigate"].execute(tool_context(world, nav_step, settings=limited), args)
    await TOOL["browser.navigate"].execute(tool_context(world, nav_step, settings=limited), args)
    with pytest.raises(RateLimited):
        await TOOL["browser.navigate"].execute(tool_context(world, nav_step, settings=limited), args)


async def test_failed_task_is_rearmed_on_retry(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.click", status="running")
    tool = TOOL["browser.click"]
    args = tool.parse_args({"url": "https://example.com", "target": {"role": "button", "name": "Save"},
                            "expect_text": "Saved"})
    first = await tool.execute(tool_context(world, step), args)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        task = await s.get(BrowserTask, uuid.UUID(str(first.external_ref)))
        assert task is not None
        task.status, task.error_class, task.error_message = BrowserTaskStatus.FAILED, "timeout", "slow"
        task.result = {"browser_task_id": str(task.id), "status": "failed"}
        await s.commit()
    second = await tool.execute(tool_context(world, step, attempt=2), args)
    assert second.external_ref == first.external_ref
    (task,) = await _browser_tasks(world)
    assert task.status == BrowserTaskStatus.QUEUED
    assert task.result is None and task.error_class is None
    assert task.options["step_attempt"] == 2 and task.options["max_step_attempts"] == 2
    assert task.options["side_effects"] is True and task.options["expect"] == {"text": "Saved"}
    async with get_session_factory()() as s:
        s.info["system"] = True
        audits = (await s.execute(select(AuditLog).where(AuditLog.tenant_id == world.tenant_id,
                                                         AuditLog.action == "browser.task.dispatched"))).scalars().all()
    assert len(audits) == 2


async def test_interactive_run_is_never_repeated_blindly(world: World, make_step: Any, resolver: Any) -> None:
    resolver(PUBLIC)
    step = await make_step("browser.run", status="running")
    tool = TOOL["browser.run"]
    args = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"},
                                        {"type": "click", "target": {"text": "Buy"}}]})
    tctx = tool_context(world, step)
    await tool.execute(tctx, args)
    # A later attempt (new per-attempt key) while the first is still queued: the first is superseded.
    tctx2 = tool_context(world, step, attempt=2, idempotency_key=f"{step.idempotency_key}:2")
    await tool.execute(tctx2, args)
    first, second = await _browser_tasks(world)
    assert first.status == BrowserTaskStatus.CANCELLED
    assert second.status == BrowserTaskStatus.QUEUED
    # Once an attempt has run its clicks, a further attempt needs the user.
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        row = await s.get(BrowserTask, second.id)
        assert row is not None
        row.status = BrowserTaskStatus.SUCCEEDED
        await s.commit()
    tctx3 = tool_context(world, step, attempt=3, idempotency_key=f"{step.idempotency_key}:3")
    with pytest.raises(NeedsUserInput):
        await tool.execute(tctx3, args)
    # Read-only sequences are unaffected.
    reads = tool.parse_args({"actions": [{"type": "navigate", "url": "https://example.com"}]})
    tctx4 = tool_context(world, step, attempt=4, idempotency_key=f"{step.idempotency_key}:4")
    assert (await tool.execute(tctx4, reads)).pending_external
