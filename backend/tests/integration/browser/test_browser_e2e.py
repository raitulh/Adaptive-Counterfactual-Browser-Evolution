"""Tool dispatch → browser.run job (real Chromium) → external outcome → verification."""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
import pytest_asyncio
from browser_itkit import World, job_context, tool_context
from browser_testkit import FakeStorage, LocalSite, executor_settings, local_policy, trusted_host_policy

from app.browser import tools as browser_tools
from app.browser.executor import BrowserExecutor
from app.browser.jobs import BrowserJobRunner
from app.browser.models import BrowserTask, BrowserTaskStatus
from app.browser.policy import BrowserEgressPolicy
from app.browser.tools import TOOLS
from app.core.database import get_session_factory
from app.tasks.models import TaskStep
from app.tools.base import ToolResult

pytestmark = [pytest.mark.integration, pytest.mark.browser]

TOOL = {t.spec.name: t for t in TOOLS}


@pytest.fixture(scope="module")
def site() -> Iterator[LocalSite]:
    server = LocalSite().start()
    yield server
    server.stop()


@pytest_asyncio.fixture(scope="module", loop_scope="session")
async def browser() -> AsyncIterator[tuple[BrowserExecutor, FakeStorage]]:
    storage = FakeStorage()
    executor = BrowserExecutor(executor_settings(), storage, no_sandbox=os.geteuid() == 0)
    yield executor, storage
    await executor.aclose()


async def _dispatch_and_run(world: World, make_step: Any, monkeypatch: pytest.MonkeyPatch,
                            executor: BrowserExecutor, policy: BrowserEgressPolicy, tool_name: str,
                            raw_args: dict[str, Any]) -> tuple[Any, Any, TaskStep]:
    # Point the deployment policy at the local test site (it runs on a private address and a random port).
    monkeypatch.setattr(browser_tools, "build_browser_policy", lambda settings, **kw: policy)
    tool = TOOL[tool_name]
    step = await make_step(tool_name, status="running")
    tctx = tool_context(world, step)
    args = tool.parse_args(raw_args)
    dispatched = await tool.execute(tctx, args)
    assert dispatched.pending_external
    async with get_session_factory()() as s:  # what the engine's _record_success does
        s.info["tenant_id"] = world.tenant_id
        row = await s.get(TaskStep, step.id)
        assert row is not None
        row.status = "waiting_external"
        await s.commit()
    runner = BrowserJobRunner(executor, settings=executor_settings(), policy_factory=lambda settings, **kw: policy)
    ctx, payload = job_context(world.tenant_id, uuid.UUID(dispatched.output["browser_task_id"]))
    await runner.handle(ctx, payload)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        final = await s.get(TaskStep, step.id)
        assert final is not None
    return tool, args, final


async def test_fill_and_submit_is_verified_with_evidence(world: World, make_step: Any, site: LocalSite,
                                                         browser: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    executor, _ = browser
    tool, args, step = await _dispatch_and_run(
        world, make_step, monkeypatch, executor, local_policy(site), "browser.fill",
        {"url": f"{site.base}/post-form", "target": {"label": "Message"}, "value": "hello world", "submit": True,
         "expect_text": "Your message was saved", "expect_url_contains": "/save"})
    assert step.status == "verifying", step.error_message
    assert {"m": ["hello world"]} in site.submissions
    outcome = await tool.verify(tool_context(world, step), args, ToolResult(output=step.output, summary=""))
    assert outcome.passed, outcome.differences
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        assert step.output is not None
        bt = await s.get(BrowserTask, uuid.UUID(step.output["browser_task_id"]))
        assert bt is not None and bt.status == BrowserTaskStatus.SUCCEEDED
        assert "hello world" not in str(bt.actions)  # typed value redacted once finished


async def test_extract_is_verified(world: World, make_step: Any, site: LocalSite, browser: Any,
                                   monkeypatch: pytest.MonkeyPatch) -> None:
    executor, _ = browser
    tool, args, step = await _dispatch_and_run(
        world, make_step, monkeypatch, executor, local_policy(site), "browser.extract",
        {"url": f"{site.base}/", "target": {"test_id": "promo"}})
    assert step.status == "verifying"
    assert step.output is not None
    assert step.output["extracts"][0]["content"] == "Promo text"
    assert (await tool.verify(tool_context(world, step), args, ToolResult(output=step.output, summary=""))).passed


async def test_redirect_to_private_network_fails_the_step(world: World, make_step: Any, site: LocalSite,
                                                          browser: Any, monkeypatch: pytest.MonkeyPatch) -> None:
    executor, _ = browser
    _, _, step = await _dispatch_and_run(
        world, make_step, monkeypatch, executor, trusted_host_policy(site), "browser.navigate",
        {"url": f"{site.base}/redir-private"})
    assert step.status == "failed"
    assert step.error_class == "policy_blocked"
    assert site.canary_hits == []
