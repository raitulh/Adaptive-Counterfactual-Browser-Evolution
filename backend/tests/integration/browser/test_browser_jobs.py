"""``browser.run`` job handler (scripted executor), reconciliation and artifact retention."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import pytest
from browser_itkit import ScriptedExecutor, World, job_context, tool_context
from browser_testkit import FakeStorage, executor_settings
from sqlalchemy import select

from app.browser import service
from app.browser.actions import REDACTED
from app.browser.jobs import BrowserJobRunner
from app.browser.models import BrowserSession, BrowserSessionStatus, BrowserTask, BrowserTaskStatus
from app.browser.schemas import BrowserRunResult, ExpectationCheck
from app.browser.tools import TOOLS
from app.common.enums import ErrorClass
from app.common.time import utcnow
from app.core.database import get_session_factory
from app.tasks.models import Task, TaskStep
from app.tools.base import ReconcileStatus
from app.usage.models import UsageEvent, UsageKind
from app.workers.jobs.registry import get_handler
from app.workers.queues.base import DeferJob, PermanentJobFailure

pytestmark = pytest.mark.integration

TOOL = {t.spec.name: t for t in TOOLS}
READ: list[dict[str, Any]] = [{"type": "navigate", "url": "https://example.com/"},
                              {"type": "extract", "mode": "text"}]
WRITE: list[dict[str, Any]] = [{"type": "navigate", "url": "https://example.com/"},
                               {"type": "fill", "target": {"label": "Email"}, "value": "me@example.com"},
                               {"type": "click", "target": {"role": "button", "name": "Send"}}]


def _ok(**kw: Any) -> BrowserRunResult:
    values: dict[str, Any] = {"ok": True, "final_url": "https://example.com/done", "final_url_allowed": True,
                              "title": "Done", "actions_executed": 2, "pages_visited": 1, "duration_ms": 1500}
    values.update(kw)
    return BrowserRunResult(**values)


def _fail(code: str, cls: ErrorClass, **kw: Any) -> BrowserRunResult:
    values: dict[str, Any] = {"ok": False, "error_code": code, "error_class": cls, "error_message": f"{code} happened",
                              "actions_executed": 1, "duration_ms": 800}
    values.update(kw)
    return BrowserRunResult(**values)


async def _dispatch(world: World, step: TaskStep, actions: list[dict[str, Any]], *, tool: str = "browser.run",
                    options: dict[str, Any] | None = None) -> uuid.UUID:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        task, _ = await service.dispatch_browser_task(
            s, tenant_id=world.tenant_id, user_id=world.user_id, task_id=world.task_id, step_id=step.id,
            idempotency_key=step.idempotency_key, tool_name=tool, actions=actions,
            options=options or {"step_attempt": 1, "max_step_attempts": 3}, timeout_seconds=60)
        await s.commit()
        return task.id


async def _get(world: World, model: Any, ident: uuid.UUID) -> Any:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        return await s.get(model, ident)


async def _update(world: World, bt_id: uuid.UUID, **values: Any) -> None:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        row = await s.get(BrowserTask, bt_id)
        assert row is not None
        for key, value in values.items():
            setattr(row, key, value)
        await s.commit()


async def _run_job(world: World, bt_id: uuid.UUID, executor: ScriptedExecutor, *, attempt: int = 1,
                   max_attempts: int = 5) -> None:
    runner = BrowserJobRunner(executor, settings=executor_settings())
    ctx, payload = job_context(world.tenant_id, bt_id, attempt=attempt, max_attempts=max_attempts)
    await runner.handle(ctx, payload)


# ---------------------------------------------------------------------------- happy path
async def test_success_flow_persists_and_reports(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, WRITE, options={"step_attempt": 1, "max_step_attempts": 2,
                                                         "locator_order": ["label", "role"],
                                                         "expect": {"text": "Sent"}})
    executor = ScriptedExecutor(_ok(side_effect_started=True, actions_executed=3,
                                    checks=[ExpectationCheck(kind="text", expected="Sent", satisfied=True)]))
    await _run_job(world, bt_id, executor)

    (request,) = executor.requests
    assert request.locator_order[:2] == ("label", "role")
    assert request.expectations is not None and request.expectations.text == "Sent"
    assert request.timeout_seconds == 60

    bt = await _get(world, BrowserTask, bt_id)
    assert bt.status == BrowserTaskStatus.SUCCEEDED
    assert bt.attempts == 1 and bt.started_at and bt.completed_at
    assert bt.result["final_url"] == "https://example.com/done"
    assert bt.actions[1]["value"] == REDACTED  # typed values are not kept
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        (session_row,) = (await s.execute(select(BrowserSession).where(
            BrowserSession.browser_task_id == bt_id))).scalars().all()
        usage = (await s.execute(select(UsageEvent).where(UsageEvent.task_id == world.task_id))).scalars().all()
    assert session_row.status == BrowserSessionStatus.CLOSED
    assert session_row.actions_count == 3 and session_row.pages_visited == 1 and session_row.ended_at
    assert session_row.worker_id == "browser-test-worker"
    kinds = {u.kind: u.quantity for u in usage}
    assert kinds[UsageKind.BROWSER_SECONDS] == pytest.approx(1.5)
    assert kinds[UsageKind.BROWSER_ACTION] == 3

    step_row = await _get(world, TaskStep, step.id)
    assert step_row.status == "verifying"
    assert step_row.output["browser_task_id"] == str(bt_id)
    assert step_row.output_trust == "untrusted_external_content"
    assert step_row.external_ref == str(bt_id)
    task_row = await _get(world, Task, world.task_id)
    assert task_row.browser_actions == 3

    # The stored observations verify against the tool's arguments.
    args = TOOL["browser.run"].parse_args({"actions": WRITE, "expect_text": "Sent"})
    from app.tools.base import ToolResult

    outcome = await TOOL["browser.run"].verify(tool_context(world, step), args,
                                               ToolResult(output=step_row.output, summary=""))
    assert outcome.passed

    # Re-delivery of the job is idempotent: no second run, no second report.
    again = ScriptedExecutor()
    await _run_job(world, bt_id, again)
    assert again.requests == []
    assert (await _get(world, Task, world.task_id)).browser_actions == 3


async def test_session_row_goes_active_during_run(world: World, make_step: Any) -> None:
    step = await make_step("browser.navigate")
    bt_id = await _dispatch(world, step, READ, tool="browser.navigate")
    seen: list[str] = []

    class Probe(ScriptedExecutor):
        async def run(self, request: Any) -> BrowserRunResult:
            await request.on_active()
            async with get_session_factory()() as s:
                s.info["tenant_id"] = world.tenant_id
                rows = (await s.execute(select(BrowserSession.status).where(
                    BrowserSession.browser_task_id == bt_id))).scalars().all()
                seen.extend(rows)
                task = await s.get(BrowserTask, bt_id)
                assert task is not None and task.status == BrowserTaskStatus.RUNNING
            return _ok()

    await _run_job(world, bt_id, Probe())
    assert seen == [BrowserSessionStatus.ACTIVE]


# ---------------------------------------------------------------------------- failures
@pytest.mark.parametrize(("actions", "result", "task_error", "step_status"), [
    (READ, _fail("navigation_blocked", ErrorClass.POLICY_BLOCKED), "policy_blocked", "failed"),
    (READ, _fail("target_not_found", ErrorClass.INVALID_INPUT), "invalid_input", "failed"),
    (READ, _fail("navigation_timeout", ErrorClass.TIMEOUT), "timeout", "retry_scheduled"),
    (READ, _fail("browser_crashed", ErrorClass.TOOL_UNAVAILABLE, crashed=True), "tool_unavailable",
     "retry_scheduled"),
    # Interactive run that failed before any click/fill: nothing happened, not ambiguous.
    (WRITE, _fail("target_not_found", ErrorClass.INVALID_INPUT), "invalid_input", "failed"),
    (WRITE, _fail("navigation_timeout", ErrorClass.TIMEOUT), "timeout", "retry_scheduled"),
    # After a click/fill, or on a crash, the effect is unknown.
    (WRITE, _fail("action_timeout", ErrorClass.TIMEOUT, side_effect_started=True), "unknown_outcome",
     "requires_reconciliation"),
    (WRITE, _fail("browser_crashed", ErrorClass.TOOL_UNAVAILABLE, crashed=True), "unknown_outcome",
     "requires_reconciliation"),
])
async def test_failure_classification(world: World, make_step: Any, actions: list[dict[str, Any]],
                                      result: BrowserRunResult, task_error: str, step_status: str) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, actions)
    await _run_job(world, bt_id, ScriptedExecutor(result))
    bt = await _get(world, BrowserTask, bt_id)
    assert bt.status == BrowserTaskStatus.FAILED
    assert bt.error_class == task_error
    assert bt.result["status"] == "failed"
    step_row = await _get(world, TaskStep, step.id)
    assert step_row.status == step_status
    assert step_row.error_class == task_error
    session_row = (await _sessions(world, bt_id))[0]
    assert session_row.status == (BrowserSessionStatus.CRASHED if result.crashed else BrowserSessionStatus.CLOSED)


async def test_executor_exception_counts_as_crash(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ)
    await _run_job(world, bt_id, ScriptedExecutor(RuntimeError("chromium exploded")))
    bt = await _get(world, BrowserTask, bt_id)
    assert bt.error_class == ErrorClass.TOOL_UNAVAILABLE.value
    assert "chromium" not in (bt.error_message or "")
    assert (await _get(world, TaskStep, step.id)).status == "retry_scheduled"


async def test_retries_stop_at_the_tools_limit(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ, options={"step_attempt": 3, "max_step_attempts": 3})
    await _run_job(world, bt_id, ScriptedExecutor(_fail("navigation_timeout", ErrorClass.TIMEOUT)))
    bt = await _get(world, BrowserTask, bt_id)
    assert bt.error_class == ErrorClass.UNKNOWN.value
    assert "retries exhausted" in (bt.error_message or "")
    assert (await _get(world, TaskStep, step.id)).status == "failed"


# ---------------------------------------------------------------------------- crash recovery
async def _sessions(world: World, bt_id: uuid.UUID) -> list[BrowserSession]:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        return list((await s.execute(select(BrowserSession).where(BrowserSession.browser_task_id == bt_id)
                                     .order_by(BrowserSession.started_at))).scalars().all())


async def _simulate_running(world: World, step: TaskStep, bt_id: uuid.UUID, *, age_seconds: float) -> None:
    started = utcnow() - timedelta(seconds=age_seconds)
    await _update(world, bt_id, status=BrowserTaskStatus.RUNNING, started_at=started, attempts=1)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        s.add(BrowserSession(tenant_id=world.tenant_id, task_id=world.task_id, step_id=step.id,
                             browser_task_id=bt_id, worker_id="dead-worker", status=BrowserSessionStatus.ACTIVE,
                             started_at=started))
        await s.commit()


async def test_task_running_elsewhere_defers(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ)
    await _simulate_running(world, step, bt_id, age_seconds=5)
    executor = ScriptedExecutor()
    with pytest.raises(DeferJob):
        await _run_job(world, bt_id, executor)
    assert executor.requests == []


async def test_interrupted_read_only_task_is_rerun(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ)
    await _simulate_running(world, step, bt_id, age_seconds=600)
    executor = ScriptedExecutor(_ok())
    await _run_job(world, bt_id, executor, attempt=2)
    assert len(executor.requests) == 1
    bt = await _get(world, BrowserTask, bt_id)
    assert bt.status == BrowserTaskStatus.SUCCEEDED and bt.attempts == 2
    statuses = [row.status for row in await _sessions(world, bt_id)]
    assert statuses == [BrowserSessionStatus.CRASHED, BrowserSessionStatus.CLOSED]
    assert (await _get(world, TaskStep, step.id)).status == "verifying"


async def test_interrupted_interactive_task_is_reported_ambiguous(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, WRITE)
    await _simulate_running(world, step, bt_id, age_seconds=600)
    executor = ScriptedExecutor()
    await _run_job(world, bt_id, executor, attempt=2)
    assert executor.requests == []  # never re-clicked
    bt = await _get(world, BrowserTask, bt_id)
    assert bt.error_class == ErrorClass.UNKNOWN_OUTCOME.value
    assert (await _get(world, TaskStep, step.id)).status == "requires_reconciliation"


async def _set_step(world: World, step_id: uuid.UUID, status: str) -> None:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        row = await s.get(TaskStep, step_id)
        assert row is not None
        row.status = status
        await s.commit()


async def test_job_waits_until_the_engine_recorded_the_dispatch(world: World, make_step: Any) -> None:
    step = await make_step("browser.run", status="running")
    bt_id = await _dispatch(world, step, READ)
    executor = ScriptedExecutor(_ok())
    with pytest.raises(DeferJob):
        await _run_job(world, bt_id, executor)
    assert executor.requests == []
    await _set_step(world, step.id, "waiting_external")
    await _run_job(world, bt_id, executor)
    assert len(executor.requests) == 1
    assert (await _get(world, TaskStep, step.id)).status == "verifying"


async def test_job_for_a_step_that_moved_on_is_cancelled(world: World, make_step: Any) -> None:
    step = await make_step("browser.run", status="failed")
    bt_id = await _dispatch(world, step, WRITE)
    executor = ScriptedExecutor()
    await _run_job(world, bt_id, executor)
    assert executor.requests == []  # never clicks for a step nobody waits for
    assert (await _get(world, BrowserTask, bt_id)).status == BrowserTaskStatus.CANCELLED


async def test_early_report_is_retried_until_the_step_waits(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ)
    await _run_job(world, bt_id, ScriptedExecutor(_ok()))
    # The step is retried with the same key (side-effecting tools keep their key): the finished task is
    # re-dispatched and its job may run before the engine marks the step as waiting again.
    await _set_step(world, step.id, "running")
    with pytest.raises(DeferJob):
        await _run_job(world, bt_id, ScriptedExecutor())
    await _set_step(world, step.id, "waiting_external")
    again = ScriptedExecutor()
    await _run_job(world, bt_id, again)
    assert again.requests == []
    assert (await _get(world, TaskStep, step.id)).status == "verifying"


async def test_cancelled_task_is_not_run(world: World, make_step: Any) -> None:
    step = await make_step("browser.run")
    bt_id = await _dispatch(world, step, READ)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        task = await s.get(Task, world.task_id)
        assert task is not None
        task.cancel_requested_at = utcnow()
        await s.commit()
    executor = ScriptedExecutor()
    await _run_job(world, bt_id, executor)
    assert executor.requests == []
    assert (await _get(world, BrowserTask, bt_id)).status == BrowserTaskStatus.CANCELLED


async def test_malformed_payload_and_missing_task() -> None:
    runner = BrowserJobRunner(ScriptedExecutor(), settings=executor_settings())
    ctx, _ = job_context(uuid.uuid4(), uuid.uuid4())
    with pytest.raises(PermanentJobFailure):
        await runner.handle(ctx, {"browser_task_id": "nope"})
    ctx, payload = job_context(uuid.uuid4(), uuid.uuid4())
    await runner.handle(ctx, payload)  # unknown task: nothing to do


def test_handler_is_registered() -> None:
    import app.browser.jobs  # noqa: F401

    assert get_handler("browser.run") is not None


# ---------------------------------------------------------------------------- reconcile
async def test_reconcile_outcomes(world: World, make_step: Any) -> None:
    tool = TOOL["browser.click"]
    args = tool.parse_args({"url": "https://example.com", "target": {"role": "button", "name": "Send"}})

    missing = await make_step("browser.click")
    assert (await tool.reconcile(tool_context(world, missing), args)).status == ReconcileStatus.NOT_FOUND

    queued = await make_step("browser.click")
    queued_id = await _dispatch(world, queued, WRITE, tool="browser.click")
    outcome = await tool.reconcile(tool_context(world, queued), args)
    assert outcome.status == ReconcileStatus.NOT_FOUND
    assert outcome.evidence["reason"] == "never started"
    assert (await _get(world, BrowserTask, queued_id)).status == BrowserTaskStatus.CANCELLED
    executor = ScriptedExecutor()
    await _run_job(world, queued_id, executor)  # the cancelled task can no longer start
    assert executor.requests == []

    running = await make_step("browser.click")
    running_id = await _dispatch(world, running, WRITE, tool="browser.click")
    await _update(world, running_id, status=BrowserTaskStatus.RUNNING, started_at=utcnow(), attempts=1)
    outcome = await tool.reconcile(tool_context(world, running), args)
    assert outcome.status == ReconcileStatus.UNKNOWN
    assert outcome.evidence["reason"] == "interrupted while running"

    done = await make_step("browser.click")
    done_id = await _dispatch(world, done, WRITE, tool="browser.click")
    await _run_job(world, done_id, ScriptedExecutor(_ok(side_effect_started=True)))
    outcome = await tool.reconcile(tool_context(world, done), args)
    assert outcome.status == ReconcileStatus.FOUND
    assert outcome.result is not None and outcome.result.output["final_url"] == "https://example.com/done"
    assert outcome.result.external_ref == str(done_id)

    ambiguous = await make_step("browser.click")
    ambiguous_id = await _dispatch(world, ambiguous, WRITE, tool="browser.click")
    await _run_job(world, ambiguous_id, ScriptedExecutor(_fail("action_timeout", ErrorClass.TIMEOUT,
                                                               side_effect_started=True)))
    assert (await tool.reconcile(tool_context(world, ambiguous), args)).status == ReconcileStatus.UNKNOWN

    before_effect = await make_step("browser.click")
    before_id = await _dispatch(world, before_effect, WRITE, tool="browser.click")
    await _run_job(world, before_id, ScriptedExecutor(_fail("target_not_found", ErrorClass.INVALID_INPUT)))
    outcome = await tool.reconcile(tool_context(world, before_effect), args)
    assert outcome.status == ReconcileStatus.NOT_FOUND
    assert outcome.evidence["reason"] == "failed before taking effect"


# ---------------------------------------------------------------------------- retention
async def test_purge_browser_artifacts(world: World, make_step: Any) -> None:
    storage = FakeStorage()
    old_id = await _dispatch(world, await make_step("browser.screenshot"), READ, tool="browser.screenshot")
    new_id = await _dispatch(world, await make_step("browser.screenshot"), READ, tool="browser.screenshot")
    live_id = await _dispatch(world, await make_step("browser.screenshot"), READ, tool="browser.screenshot")
    key = f"tenants/{world.tenant_id}/browser/{old_id}/1.png"
    storage.objects[key] = (b"png", "image/png")
    long_ago = utcnow() - timedelta(days=30)
    await _update(world, old_id, status=BrowserTaskStatus.SUCCEEDED, artifact_keys=[key], created_at=long_ago)
    await _update(world, new_id, status=BrowserTaskStatus.SUCCEEDED)
    await _update(world, live_id, status=BrowserTaskStatus.RUNNING, created_at=long_ago)
    async with get_session_factory()() as s:
        s.info["tenant_id"] = world.tenant_id
        s.add(BrowserSession(tenant_id=world.tenant_id, task_id=world.task_id, step_id=(await _get(
            world, BrowserTask, old_id)).step_id, browser_task_id=old_id, worker_id="w",
            status=BrowserSessionStatus.CLOSED, started_at=long_ago))
        await s.commit()
    async with get_session_factory()() as s:
        s.info["system"] = True
        purged = await service.purge_browser_artifacts(s, utcnow() - timedelta(days=7), storage=storage)
    assert purged >= 1
    assert key in storage.deleted and key not in storage.objects
    assert await _get(world, BrowserTask, old_id) is None
    assert await _sessions(world, old_id) == []
    assert await _get(world, BrowserTask, new_id) is not None
    assert await _get(world, BrowserTask, live_id) is not None
