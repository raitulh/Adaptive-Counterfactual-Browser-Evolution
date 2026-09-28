"""Real Chromium against a local site. The site runs on 127.0.0.1, so functional tests use a
dev-style policy (private networks allowed); security tests use the default policy or a
policy that trusts only the site host and prove private destinations are never reached."""

from __future__ import annotations

import os
import uuid
from typing import Any

import pytest
from browser_testkit import FakeStorage, LocalSite, executor_settings, local_policy, trusted_host_policy

from app.browser.actions import parse_actions
from app.browser.executor import BrowserExecutor
from app.browser.policy import BrowserEgressPolicy, build_browser_policy
from app.browser.schemas import BrowserRunRequest, BrowserRunResult, Expectations
from app.common.enums import ErrorClass
from app.core.config import Settings

pytestmark = [pytest.mark.browser, pytest.mark.asyncio(loop_scope="session")]


async def _run(executor: BrowserExecutor, actions: list[dict[str, Any]], policy: BrowserEgressPolicy, *,
               expectations: Expectations | None = None, locator_order: tuple[str, ...] | None = None,
               timeout: float | None = None, tenant_id: uuid.UUID | None = None) -> BrowserRunResult:
    request = BrowserRunRequest(
        browser_task_id=uuid.uuid4(), tenant_id=tenant_id or uuid.uuid4(),
        actions=parse_actions(actions, max_actions=50), policy=policy, expectations=expectations,
        timeout_seconds=timeout)
    if locator_order is not None:
        request.locator_order = locator_order  # type: ignore[assignment]
    return await executor.run(request)


# ---------------------------------------------------------------------------- functional
async def test_navigate_extract_and_observe(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [
        {"type": "navigate", "url": f"{site.base}/"},
        {"type": "extract", "mode": "text", "target": {"css": "#para"}},
        {"type": "extract", "mode": "aria"},
        {"type": "extract", "mode": "html_outline"},
    ], local_policy(site))
    assert result.ok, result.error_message
    assert result.final_url == f"{site.base}/"
    assert result.final_url_allowed
    assert result.title == "Home"
    assert result.ready_state == "complete"
    assert [e.mode for e in result.extracts] == ["text", "aria", "html_outline"]
    assert result.extracts[0].content == "Paragraph text"
    assert 'heading "Welcome"' in result.extracts[1].content
    assert "form[method=get action=/submit]" in result.extracts[2].content
    assert "<" not in result.extracts[2].content  # outline, never raw HTML
    assert result.aria_snapshot and "Welcome" in result.aria_snapshot
    assert result.pages_visited == 1
    assert result.actions_executed == 4
    assert not result.side_effect_started
    assert [e.status for e in result.action_log] == ["ok"] * 4


async def test_fill_select_click_wait_and_expectations(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [
        {"type": "navigate", "url": f"{site.base}/"},
        {"type": "fill", "target": {"label": "Query"}, "value": "private-value-123"},
        {"type": "select_option", "target": {"role": "combobox", "name": "Color"}, "value": "blue"},
        {"type": "click", "target": {"role": "button", "name": "Search"}},
        {"type": "wait_for", "url_contains": "/submit", "timeout_ms": 3000},
        {"type": "wait_for", "text": "Results for", "timeout_ms": 3000},
    ], local_policy(site), expectations=Expectations(url_contains="q=private-value-123", text="Color blue"))
    assert result.ok, result.error_message
    assert result.side_effect_started
    assert result.title == "Results"
    assert {(c.kind, c.satisfied) for c in result.checks} == {("url_contains", True), ("text", True)}
    fill_log = result.action_log[1]
    assert fill_log.detail == {"target": "label='Query'", "value_chars": 17}
    assert "private-value-123" not in str([e.model_dump() for e in result.action_log])
    assert result.pages_visited == 2


async def test_expectations_report_unsatisfied_without_failing(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"}], local_policy(site),
                        expectations=Expectations(url_contains="/nowhere", text="Never shown"))
    assert result.ok
    assert all(not c.satisfied for c in result.checks)


async def test_ambiguous_target_is_an_error_and_nothing_is_clicked(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [
        {"type": "navigate", "url": f"{site.base}/"},
        {"type": "click", "target": {"role": "button", "name": "Dup"}},
    ], local_policy(site))
    assert not result.ok
    assert result.error_code == "ambiguous_target"
    assert result.error_class == ErrorClass.INVALID_INPUT
    assert not result.side_effect_started  # never guessed, never clicked
    assert result.action_log[-1].status == "error"


async def test_missing_target_is_target_not_found(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [
        {"type": "navigate", "url": f"{site.base}/"},
        {"type": "click", "target": {"text": "No such button"}},
    ], local_policy(site))
    assert result.error_code == "target_not_found"
    assert not result.side_effect_started


async def test_locator_order_prefers_configured_strategy(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    # role=button name=Dup is ambiguous, but test_id is tried first and is unique.
    target = {"role": "button", "name": "Dup", "test_id": "promo"}
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"},
                                   {"type": "extract", "target": target}],
                        local_policy(site), locator_order=("test_id", "role", "label", "text", "css"))
    assert result.ok, result.error_message
    assert result.extracts[0].content == "Promo text"
    default_order = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"},
                                          {"type": "extract", "target": target}], local_policy(site))
    assert default_order.error_code == "ambiguous_target"


async def test_screenshot_is_stored_under_tenant_key(executor_pair: Any, site: LocalSite) -> None:
    executor, store = executor_pair
    tenant_id = uuid.uuid4()
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"}, {"type": "screenshot"}],
                        local_policy(site), tenant_id=tenant_id)
    assert result.ok
    (key,) = result.screenshots
    assert key.startswith(f"tenants/{tenant_id}/browser/") and key.endswith("/1.png")
    data, content_type = store.objects[key]
    assert data.startswith(b"\x89PNG") and content_type == "image/png"


async def test_dialogs_are_dismissed_and_popups_closed(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [
        {"type": "navigate", "url": f"{site.base}/dialog"},
        {"type": "click", "target": {"role": "button", "name": "Alert"}},
        {"type": "wait_for", "text": "after alert", "timeout_ms": 3000},
        {"type": "navigate", "url": f"{site.base}/popup"},
        {"type": "click", "target": {"role": "button", "name": "Open"}},
        {"type": "extract", "mode": "text"},
    ], local_policy(site))
    assert result.ok, result.error_message
    assert result.final_url == f"{site.base}/popup"


async def test_max_actions_enforced_before_launch(site: LocalSite) -> None:
    executor = BrowserExecutor(executor_settings(browser_max_actions=2), FakeStorage(), no_sandbox=True)
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"}, {"type": "extract"},
                                   {"type": "extract"}], local_policy(site))
    assert result.error_code == "too_many_actions"
    assert result.error_class == ErrorClass.INVALID_INPUT
    assert executor.launches == 0
    await executor.aclose()


async def test_total_timeout(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/slow-text"},
                                   {"type": "wait_for", "text": "never appears", "timeout_ms": 60_000}],
                        local_policy(site), timeout=2)
    assert not result.ok
    assert result.error_class == ErrorClass.TIMEOUT
    assert result.error_code in ("task_timeout", "wait_timeout")
    assert result.duration_ms < 10_000


async def test_no_state_persists_across_tasks(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    first = await _run(executor, [{"type": "navigate", "url": f"{site.base}/set-state"},
                                  {"type": "navigate", "url": f"{site.base}/check-state"},
                                  {"type": "extract", "target": {"css": "#out"}}], local_policy(site))
    assert first.ok
    assert "session=abc123" in first.extracts[0].content and "value1" in first.extracts[0].content
    second = await _run(executor, [{"type": "navigate", "url": f"{site.base}/check-state"},
                                   {"type": "extract", "target": {"css": "#out"}}], local_policy(site))
    assert second.ok
    assert second.extracts[0].content == "cookie=[] storage=[]"


async def test_browser_is_reused_and_recycled(site: LocalSite) -> None:
    executor = BrowserExecutor(executor_settings(), FakeStorage(), no_sandbox=os.geteuid() == 0, recycle_after=2)
    try:
        for _ in range(3):
            result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/api-ok"}], local_policy(site))
            assert result.ok
        assert executor.launches == 2
    finally:
        await executor.aclose()


# ---------------------------------------------------------------------------- security
@pytest.mark.parametrize("url", [
    "http://127.0.0.1:{port}/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.5/",
    "http://192.168.0.10/", "http://localhost:{port}/",
])
async def test_default_policy_blocks_local_network_navigation(executor_pair: Any, site: LocalSite,
                                                              url: str) -> None:
    executor, _ = executor_pair
    hits_before = len(site.hits)
    policy = build_browser_policy(Settings(allow_private_network_egress=False))
    result = await _run(executor, [{"type": "navigate", "url": url.format(port=site.port)}], policy)
    assert not result.ok
    assert result.error_code == "navigation_blocked"
    assert result.error_class == ErrorClass.POLICY_BLOCKED
    assert result.blocked_requests and result.blocked_requests[0].source == "navigation"
    assert len(site.hits) == hits_before


async def test_file_urls_cannot_be_opened(executor_pair: Any, site: LocalSite) -> None:
    with pytest.raises(ValueError, match="http"):
        parse_actions([{"type": "navigate", "url": "file:///etc/passwd"}], max_actions=5)
    executor, _ = executor_pair
    # Page-initiated attempts (iframe, fetch, link) never expose local files.
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/file-probe"},
                                   {"type": "click", "target": {"css": "#local"}},
                                   {"type": "extract", "mode": "text"}], local_policy(site))
    assert result.final_url == f"{site.base}/file-probe"
    assert all("root:" not in e.content for e in result.extracts)
    assert result.aria_snapshot is not None and "root:" not in result.aria_snapshot


async def test_private_subrequests_are_aborted(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/subrequests"},
                                   {"type": "wait_for", "text": "Loaded", "timeout_ms": 3000}],
                        trusted_host_policy(site))
    assert result.ok, result.error_message
    blocked = " ".join(f"{r.url} {r.reason}" for r in result.blocked_requests)
    assert "127.0.0.2" in blocked
    assert "10.1.2.3" in blocked
    assert "169.254.169.254" in blocked
    assert "private or reserved" in blocked
    assert site.canary_hits == []  # nothing ever reached the private canary
    assert "/api-ok" in site.hits  # the allowed same-origin fetch went through


async def test_redirects_to_private_addresses_are_blocked(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    for path in ("/redir-private", "/redir-metadata"):
        result = await _run(executor, [{"type": "navigate", "url": f"{site.base}{path}"}], trusted_host_policy(site))
        assert not result.ok
        assert result.error_code == "navigation_blocked", path
        assert any(r.source == "proxy" for r in result.blocked_requests)
    assert site.canary_hits == []


async def test_downloads_are_blocked_by_default(executor_pair: Any, site: LocalSite) -> None:
    executor, store = executor_pair
    before = set(store.objects)
    clicked = await _run(executor, [{"type": "navigate", "url": f"{site.base}/dl-page"},
                                    {"type": "click", "target": {"role": "link", "name": "Get file"}},
                                    {"type": "wait_for", "url_contains": "dl-page", "timeout_ms": 1000}],
                         local_policy(site))
    assert clicked.downloads and not clicked.downloads[0].allowed
    assert any(r.source == "download" for r in clicked.blocked_requests)
    direct = await _run(executor, [{"type": "navigate", "url": f"{site.base}/download"}], local_policy(site))
    assert direct.error_code == "download_blocked"
    assert direct.error_class == ErrorClass.POLICY_BLOCKED
    assert set(store.objects) == before  # nothing persisted


async def test_file_uploads_are_blocked(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/upload"},
                                   {"type": "click", "target": {"css": "#f"}},
                                   {"type": "wait_for", "text": "File", "timeout_ms": 1000}], local_policy(site))
    assert any(r.source == "upload" for r in result.blocked_requests)
    fill = await _run(executor, [{"type": "navigate", "url": f"{site.base}/upload"},
                                 {"type": "fill", "target": {"label": "File"}, "value": "/etc/passwd"}],
                      local_policy(site))
    assert not fill.ok


async def test_org_denylist_applies_to_navigation(executor_pair: Any, site: LocalSite) -> None:
    executor, _ = executor_pair
    policy = BrowserEgressPolicy(local_policy(site).egress, extra_allowlists=(("docs.example.com",),))
    result = await _run(executor, [{"type": "navigate", "url": f"{site.base}/"}], policy)
    assert result.error_code == "navigation_blocked"
