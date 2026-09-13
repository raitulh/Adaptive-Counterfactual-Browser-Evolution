"""
Real browser automation backend, built on Playwright/Chromium.

This module intentionally does NOT import playwright at module load time --
the dependency is optional (``pip install acbe[browser]``) and this file
must remain importable (and unit-testable with mocks) even in environments
where the Playwright browser binaries have not been downloaded
(``playwright install chromium``).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from acbe.browser.base import BrowserAdapter, BrowserActionError, RawBrowserState
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, VerificationResult

LOCATOR_TIMEOUT_MS = 5000


def _require_playwright():
    try:
        from playwright.async_api import async_playwright  # noqa: F401
    except ImportError as exc:  # pragma: no cover - exercised only w/o extra installed
        raise ImportError(
            "PlaywrightBrowserAdapter requires the 'playwright' package and its "
            "browser binaries. Install with:\n"
            "    pip install acbe[browser]\n"
            "    python -m playwright install chromium\n"
        ) from exc
    return async_playwright


class PlaywrightBrowserAdapter(BrowserAdapter):
    """Chromium automation via Playwright's async API.

    Every "important" action (Section 3) records an expected state / actual
    state pair and is verified before being reported as successful, per the
    core requirement that ACBE never blindly executes critical actions.
    """

    name = "playwright"

    def __init__(self, headless: bool = True, start_url: Optional[str] = None,
                 domain_allowlist: Optional[List[str]] = None):
        self.headless = headless
        self.start_url = start_url
        self.domain_allowlist = domain_allowlist
        self._pw = None
        self._browser = None
        self._context = None
        self._page = None

    async def start(self) -> None:
        async_playwright = _require_playwright()
        self._pw = await async_playwright().start()
        self._browser = await self._pw.chromium.launch(headless=self.headless)
        self._context = await self._browser.new_context()
        self._page = await self._context.new_page()
        if self.start_url:
            await self._navigate(self.start_url)

    async def close(self) -> None:
        if self._context:
            await self._context.close()
        if self._browser:
            await self._browser.close()
        if self._pw:
            await self._pw.stop()

    def _check_allowlist(self, url: str) -> None:
        if not self.domain_allowlist:
            return
        if not any(domain in url for domain in self.domain_allowlist):
            raise BrowserActionError(
                f"Navigation to '{url}' blocked by domain allowlist.",
                expected_state="allowlisted domain", actual_state=url,
                error_kind="ENVIRONMENT_FAILURE",
            )

    async def _navigate(self, url: str) -> None:
        self._check_allowlist(url)
        await self._page.goto(url, wait_until="domcontentloaded")

    async def observe(self) -> RawBrowserState:
        page = self._page
        url = page.url
        elements: List[Dict[str, Any]] = []
        try:
            snapshot = await page.accessibility.snapshot(interesting_only=True)
        except Exception:
            snapshot = None

        def _walk(node, out):
            if not node:
                return
            if node.get("name"):
                out.append({
                    "role": node.get("role"),
                    "accessible_name": node.get("name"),
                })
            for child in node.get("children", []) or []:
                _walk(child, out)

        if snapshot:
            _walk(snapshot, elements)

        return RawBrowserState(
            url=url,
            page_type="unknown",
            accessibility_tree=elements,
            elements=elements,
        )

    async def screenshot(self) -> Optional[str]:
        import base64
        data = await self._page.screenshot()
        return base64.b64encode(data).decode("ascii")

    def _locator_for(self, action: ActionRecord):
        page = self._page
        desc = action.target_description
        strategy = action.locator_strategy
        if strategy == LocatorStrategy.ROLE_NAME:
            role = action.params.get("role", "button")
            return page.get_by_role(role, name=desc)
        if strategy == LocatorStrategy.DOM_ROLE:
            selector = action.params.get("selector") or f"[data-testid='{desc}'], #{desc}, [name='{desc}']"
            return page.locator(selector)
        if strategy == LocatorStrategy.TEXT_VISUAL:
            return page.get_by_text(desc, exact=False)
        # semantic_search / visual_grounding / nearby_element / verify_before_click
        # fall back to a broad text match; higher-order strategies are expected
        # to be resolved by the calling agent (e.g. via a vision-grounding
        # model) and passed in as an explicit selector.
        selector = action.params.get("selector")
        if selector:
            return page.locator(selector)
        return page.get_by_text(desc, exact=False)

    async def act(self, action: ActionRecord) -> RawBrowserState:
        page = self._page
        try:
            if action.action_type == ActionType.NAVIGATE:
                await self._navigate(action.params["url"])
            elif action.action_type == ActionType.WAIT:
                await page.wait_for_timeout(action.params.get("ms", 500))
            elif action.action_type == ActionType.CLICK:
                loc = self._locator_for(action)
                if action.locator_strategy == LocatorStrategy.VERIFY_BEFORE_CLICK:
                    await loc.wait_for(state="visible", timeout=LOCATOR_TIMEOUT_MS)
                await loc.first.click(timeout=LOCATOR_TIMEOUT_MS)
            elif action.action_type == ActionType.TYPE:
                loc = self._locator_for(action)
                await loc.first.fill(str(action.params.get("value", "")), timeout=LOCATOR_TIMEOUT_MS)
            elif action.action_type == ActionType.SELECT:
                loc = self._locator_for(action)
                await loc.first.select_option(str(action.params.get("value", "")), timeout=LOCATOR_TIMEOUT_MS)
            elif action.action_type == ActionType.SCROLL:
                await page.mouse.wheel(0, action.params.get("dy", 800))
            elif action.action_type == ActionType.HOVER:
                await self._locator_for(action).first.hover(timeout=LOCATOR_TIMEOUT_MS)
            elif action.action_type == ActionType.KEYBOARD:
                await page.keyboard.press(action.params.get("key", "Enter"))
            # download/upload intentionally left to caller-provided handlers
        except Exception as exc:  # noqa: BLE001 - normalize every backend error
            raise BrowserActionError(
                f"Playwright action failed: {exc}",
                expected_state=action.target_description,
                actual_state="action_failed",
                error_kind="TOOL_FAILURE",
            ) from exc
        return await self.observe()

    async def verify(self, expected_state: str) -> VerificationResult:
        url = self._page.url
        if expected_state.startswith("url_contains:"):
            fragment = expected_state.split(":", 1)[1]
            ok = fragment in url
            return VerificationResult(verified=ok, method="url_contains",
                                       expected_state=expected_state, actual_state=url)
        ok = url == expected_state
        return VerificationResult(verified=ok, method="url_exact",
                                   expected_state=expected_state, actual_state=url)
