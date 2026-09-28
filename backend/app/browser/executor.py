"""Isolated Playwright/Chromium executor.

One ``run`` = one fresh, non-persistent browser context (no cookies, storage, cache or
service workers carried over), forced through a per-task egress proxy, with request
interception, a fixed viewport, per-action and total timeouts and an action budget. The
Chromium process may be reused by later runs of the same worker (and is recycled every
``recycle_after`` runs or after a crash), but contexts never are.

Page content is untrusted: everything read from a page is bounded and sanitized, and
nothing read from a page changes what the executor is allowed to do. There is no way to
run caller-supplied JavaScript, upload files or reach the local file system.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any

from playwright.async_api import (
    Browser,
    BrowserContext,
    Download,
    Frame,
    Locator,
    Page,
    Playwright,
    Request,
    Response,
    Route,
    async_playwright,
)
from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.browser.actions import (
    BrowserAction,
    Click,
    Extract,
    Fill,
    Navigate,
    Press,
    Screenshot,
    SelectOption,
    Target,
    WaitFor,
)
from app.browser.policy import (
    EGRESS_MARKER_HEADER,
    LOCAL_SUBRESOURCE_SCHEMES,
    NETWORK_SCHEMES,
    EgressGuard,
    EgressProxy,
    ProxyLimits,
    sanitize_url,
)
from app.browser.schemas import (
    FINAL_ARIA_MAX_CHARS,
    ActionLogEntry,
    BrowserRunRequest,
    BrowserRunResult,
    DownloadRecord,
    ExpectationCheck,
    Expectations,
    ExtractResult,
)
from app.common.enums import ErrorClass
from app.common.sanitize import clean_text
from app.core.config import Settings
from app.core.exceptions import UnsafeURL

logger = logging.getLogger(__name__)

VIEWPORT = {"width": 1280, "height": 800}
RECYCLE_AFTER_TASKS = 25
MAX_SCREENSHOTS = 5
MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
MAX_TOTAL_EXTRACT_CHARS = 60_000
MAX_REQUESTS_PER_TASK = 1_500
MAX_BYTES_PER_TASK = 64 * 1024 * 1024
OUTLINE_MAX_NODES = 400
OBSERVE_TIMEOUT_S = 3.0
EXPECT_TIMEOUT_MS = 5_000
CLOSE_TIMEOUT_S = 10.0
LAUNCH_TIMEOUT_MS = 30_000

LAUNCH_ARGS = [
    "--disable-quic",
    "--disable-sync",
    "--disable-translate",
    "--disable-notifications",
    "--disable-speech-api",
    "--disable-gpu",
    "--dns-prefetch-disable",
    "--no-pings",
    "--deny-permission-prompts",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--webrtc-ip-handling-policy=disable_non_proxied_udp",
    "--js-flags=--max-old-space-size=512",
    "--renderer-process-limit=8",
]
# Playwright disables Chromium's popup blocker by default; keep it on.
IGNORED_DEFAULT_ARGS = ["--disable-popup-blocking"]
# The browser process gets a minimal environment: no worker secrets (DB/Redis URLs, keys).
_ENV_ALLOWLIST = ("PATH", "HOME", "LANG", "LC_ALL", "TZ", "TMPDIR", "DISPLAY", "XDG_RUNTIME_DIR",
                  "FONTCONFIG_PATH", "FONTCONFIG_FILE")

# WebRTC opens UDP flows that bypass HTTP proxies and request interception.
INIT_SCRIPT = """
(() => {
  for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection", "RTCDataChannel",
                      "RTCSessionDescription", "RTCIceCandidate"]) {
    try { Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); }
    catch (e) {}
  }
})();
"""

# Structural outline of the DOM without raw HTML or form values.
OUTLINE_JS = """
(root, maxNodes) => {
  const clip = (s, n) => (s || "").replace(/\\s+/g, " ").trim().slice(0, n);
  const visible = (el) => {
    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 || r.height > 0;
  };
  const path = (href) => {
    try {
      const u = new URL(href, document.baseURI);
      return u.host === location.host ? u.pathname : u.host + u.pathname;
    } catch (e) { return ""; }
  };
  const named = (el) => (el.name ? "[name=" + clip(el.name, 40) + "]" : "");
  const sel = "h1,h2,h3,h4,h5,h6,a[href],button,input,select,textarea,form,label,img[alt],nav,main,header," +
              "footer,[role=dialog],dialog,iframe,table,[role=button],[role=link],[role=tab],[role=menuitem]";
  const out = [];
  for (const el of root.querySelectorAll(sel)) {
    if (out.length >= maxNodes) { out.push("…"); break; }
    if (!visible(el)) continue;
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute("role");
    const aria = clip(el.getAttribute("aria-label"), 80);
    const text = clip(el.innerText, 80) || aria;
    let line;
    if (/^h[1-6]$/.test(tag)) line = `${tag}: ${clip(el.innerText, 120)}`;
    else if (tag === "a") line = `link: ${text} -> ${clip(path(el.getAttribute("href")), 120)}`;
    else if (tag === "button" || role === "button") line = `button: ${text}`;
    else if (tag === "input") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (type === "hidden") continue;
      const hint = aria || clip(el.getAttribute("placeholder"), 60);
      line = `input[type=${clip(type, 20)}${el.name ? " name=" + clip(el.name, 40) : ""}]${hint ? " " + hint : ""}`;
      if (type === "submit" || type === "button") line += ` ${clip(el.value, 60)}`;
    }
    else if (tag === "select") line = `select${named(el)} (${el.options.length} options)`;
    else if (tag === "textarea") line = `textarea${named(el)}`;
    else if (tag === "form") {
      const method = clip(el.getAttribute("method") || "get", 10);
      line = `form[method=${method} action=${clip(path(el.getAttribute("action") || location.href), 120)}]`;
    }
    else if (tag === "label") line = `label: ${clip(el.innerText, 80)}`;
    else if (tag === "img") line = `img: ${clip(el.getAttribute("alt"), 80)}`;
    else if (tag === "iframe") line = `iframe -> ${clip(path(el.getAttribute("src") || ""), 120)}`;
    else line = `${role || tag}${aria ? ": " + aria : ""}`;
    out.push(line);
  }
  return out.join("\\n");
}
"""

_NET_ERROR = re.compile(r"net::(ERR_[A-Z_]+)")


class ActionError(Exception):
    def __init__(self, code: str, message: str, error_class: ErrorClass) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.error_class = error_class


@dataclass(eq=False)
class _BrowserHandle:
    browser: Browser
    uses: int = 0
    active: int = 0
    retired: bool = False
    disconnected: bool = False


@dataclass(eq=False)
class _RunState:
    guard: EgressGuard
    allow_downloads: bool
    deadline: float
    locator_order: tuple[str, ...]
    main_page: Page | None = None
    requests: int = 0
    nav_blocked: str | None = None
    page_crashed: bool = False
    side_effect_started: bool = False
    pages_visited: int = 0
    actions_executed: int = 0
    extract_chars: int = 0
    extracts: list[ExtractResult] = field(default_factory=list)
    screenshots: list[str] = field(default_factory=list)
    downloads: list[DownloadRecord] = field(default_factory=list)
    checks: list[ExpectationCheck] = field(default_factory=list)
    log: list[ActionLogEntry] = field(default_factory=list)
    pending: set[asyncio.Task[None]] = field(default_factory=set)

    def remaining_ms(self, cap: float | None = None) -> float:
        remaining = max(100.0, (self.deadline - time.monotonic()) * 1000)
        return min(remaining, cap) if cap is not None else remaining

    def spawn(self, coro: Any) -> None:
        task: asyncio.Task[None] = asyncio.ensure_future(coro)
        self.pending.add(task)
        task.add_done_callback(self.pending.discard)


@dataclass(slots=True)
class _Observation:
    final_url: str | None = None
    final_url_allowed: bool = False
    title: str | None = None
    ready_state: str | None = None
    aria_snapshot: str | None = None


class BrowserExecutor:
    def __init__(self, settings: Settings, storage: Any, *, no_sandbox: bool = False,
                 recycle_after: int = RECYCLE_AFTER_TASKS) -> None:
        self.settings = settings
        self.storage = storage
        self.no_sandbox = no_sandbox
        self.recycle_after = max(1, recycle_after)
        self._pw: Playwright | None = None
        self._handle: _BrowserHandle | None = None
        self._lock = asyncio.Lock()
        self._slots = asyncio.Semaphore(max(1, settings.browser_max_concurrency))
        self.launches = 0

    # ------------------------------------------------------------------ lifecycle
    async def aclose(self) -> None:
        async with self._lock:
            handle, self._handle = self._handle, None
            if handle is not None:
                await self._close_browser(handle)
            if self._pw is not None:
                with contextlib.suppress(Exception):
                    await self._pw.stop()
                self._pw = None

    async def _acquire(self) -> _BrowserHandle:
        async with self._lock:
            handle = self._handle
            if handle is None or handle.retired or handle.disconnected or not handle.browser.is_connected():
                if handle is not None:
                    handle.retired = True
                    if handle.active == 0:
                        await self._close_browser(handle)
                handle = await self._launch()
                self._handle = handle
            handle.uses += 1
            handle.active += 1
            if handle.uses >= self.recycle_after:
                handle.retired = True
            return handle

    async def _release(self, handle: _BrowserHandle, *, broken: bool) -> None:
        async with self._lock:
            handle.active -= 1
            if broken:
                handle.retired = True
            if handle.retired and handle.active == 0:
                if self._handle is handle:
                    self._handle = None
                await self._close_browser(handle)

    async def _launch(self) -> _BrowserHandle:
        if self._pw is None:
            self._pw = await async_playwright().start()
        kwargs: dict[str, Any] = {
            "headless": self.settings.browser_headless, "args": LAUNCH_ARGS,
            "ignore_default_args": IGNORED_DEFAULT_ARGS, "chromium_sandbox": not self.no_sandbox,
            "handle_sigint": False, "handle_sigterm": False, "handle_sighup": False,
            "timeout": LAUNCH_TIMEOUT_MS, "env": {k: os.environ[k] for k in _ENV_ALLOWLIST if k in os.environ},
        }
        if self.settings.browser_executable_path:
            kwargs["executable_path"] = self.settings.browser_executable_path
        browser = await self._pw.chromium.launch(**kwargs)
        handle = _BrowserHandle(browser)
        browser.on("disconnected", lambda _b: setattr(handle, "disconnected", True))
        self.launches += 1
        return handle

    @staticmethod
    async def _close_browser(handle: _BrowserHandle) -> None:
        with contextlib.suppress(Exception):
            await asyncio.wait_for(handle.browser.close(), timeout=CLOSE_TIMEOUT_S)

    # ------------------------------------------------------------------ run
    async def run(self, payload: BrowserRunRequest) -> BrowserRunResult:
        started = time.monotonic()
        if not payload.actions:
            return BrowserRunResult.failure("invalid_actions", "At least one browser action is required.",
                                            ErrorClass.INVALID_INPUT)
        if len(payload.actions) > self.settings.browser_max_actions:
            return BrowserRunResult.failure(
                "too_many_actions",
                f"The browser task has {len(payload.actions)} actions; the limit is "
                f"{self.settings.browser_max_actions}.", ErrorClass.INVALID_INPUT)
        limit = float(self.settings.browser_task_timeout_seconds)
        total = max(1.0, min(float(payload.timeout_seconds or limit), limit))
        async with self._slots:
            return await self._run(payload, started, total)

    async def _run(self, req: BrowserRunRequest, started: float, total: float) -> BrowserRunResult:
        allow_downloads = self.settings.browser_allow_downloads if req.allow_downloads is None else req.allow_downloads
        guard = EgressGuard(req.policy)
        state = _RunState(guard=guard, allow_downloads=allow_downloads, deadline=started + total,
                          locator_order=tuple(req.locator_order))
        proxy = EgressProxy(guard, limits=ProxyLimits(max_bytes=MAX_BYTES_PER_TASK,
                                                      max_requests=MAX_REQUESTS_PER_TASK))
        handle: _BrowserHandle | None = None
        context: BrowserContext | None = None
        error: ActionError | None = None
        crashed = False
        observation = _Observation()
        broken = False
        try:
            await proxy.start()
            try:
                handle = await self._acquire()
            except Exception:
                logger.exception("browser launch failed")
                return BrowserRunResult.failure("browser_unavailable", "The browser could not be started.",
                                                ErrorClass.TOOL_UNAVAILABLE, duration_ms=_ms_since(started))
            try:
                context = await self._new_context(handle.browser, proxy, state)
                page = await context.new_page()
                state.main_page = page
                self._harden_page(page, state)
                context.on("page", lambda p: self._on_extra_page(p, state))
                await self._notify_active(req)
                await asyncio.wait_for(self._execute_all(page, req, state),
                                       timeout=max(0.1, state.deadline - time.monotonic()))
            except TimeoutError:
                error = ActionError("task_timeout", f"The browser task exceeded its {int(total)}s time limit.",
                                    ErrorClass.TIMEOUT)
            except ActionError as exc:
                error = exc
            except PlaywrightError as exc:
                error, crashed = self._classify_error(exc, handle, state)
            if handle.disconnected or state.page_crashed:
                crashed = True
                if error is None or error.code not in ("browser_crashed", "page_crashed"):
                    error = _crash_error(state)
            if state.main_page is not None and not crashed:
                observation = await self._observe(state.main_page, state)
        except Exception:
            logger.exception("browser run failed unexpectedly")
            crashed = True
            error = ActionError("browser_error", "The browser failed unexpectedly.", ErrorClass.TOOL_UNAVAILABLE)
        finally:
            if context is not None:
                broken = not await self._close_context(context, state)
            await proxy.close()
            if handle is not None:
                await self._release(handle, broken=broken or crashed or handle.disconnected)
        if proxy.budget_exceeded and error is None:
            error = ActionError("network_budget_exceeded", "The page transferred more data than allowed.",
                                ErrorClass.POLICY_BLOCKED)
        return BrowserRunResult(
            ok=error is None, final_url=observation.final_url, final_url_allowed=observation.final_url_allowed,
            title=observation.title, ready_state=observation.ready_state, extracts=state.extracts,
            aria_snapshot=observation.aria_snapshot, screenshots=state.screenshots,
            blocked_requests=guard.blocked, blocked_total=guard.blocked_total, downloads=state.downloads,
            action_log=state.log, checks=state.checks, pages_visited=state.pages_visited,
            actions_executed=state.actions_executed, duration_ms=_ms_since(started),
            side_effect_started=state.side_effect_started, crashed=crashed,
            error_code=error.code if error else None, error_class=error.error_class if error else None,
            error_message=error.message if error else None,
        )

    async def _notify_active(self, req: BrowserRunRequest) -> None:
        if req.on_active is None:
            return
        try:
            await req.on_active()
        except Exception:
            logger.warning("browser on_active hook failed", exc_info=True)

    # ------------------------------------------------------------------ context hardening
    async def _new_context(self, browser: Browser, proxy: EgressProxy, state: _RunState) -> BrowserContext:
        context = await browser.new_context(
            proxy=proxy.playwright_config(),  # type: ignore[arg-type]
            accept_downloads=state.allow_downloads,
            service_workers="block",
            viewport=VIEWPORT,  # type: ignore[arg-type]
            screen=VIEWPORT,  # type: ignore[arg-type]
            device_scale_factor=1,
            java_script_enabled=True,
            bypass_csp=False,
            ignore_https_errors=False,
            permissions=[],
            locale="en-US",
            timezone_id="UTC",
            color_scheme="light",
            reduced_motion="reduce",
            is_mobile=False,
            has_touch=False,
        )
        context.set_default_timeout(self.settings.browser_action_timeout_ms)
        context.set_default_navigation_timeout(self._navigation_timeout_ms())
        await context.add_init_script(INIT_SCRIPT)

        async def route_handler(route: Route, request: Request) -> None:
            await self._on_route(route, request, state)

        await context.route("**/*", route_handler)
        return context

    def _harden_page(self, page: Page, state: _RunState) -> None:
        async def dismiss(dialog: Any) -> None:
            with contextlib.suppress(PlaywrightError):
                await dialog.dismiss()

        page.on("dialog", dismiss)
        page.on("filechooser", lambda _fc: state.guard.record(page.url, "file uploads are not allowed",
                                                               source="upload"))
        page.on("download", lambda d: state.spawn(self._on_download(d, state)))
        page.on("crash", lambda _p: setattr(state, "page_crashed", True))
        page.on("framenavigated", lambda f: self._on_navigated(f, page, state))
        page.on("response", lambda r: self._on_response(r, state))
        page.on("requestfailed", lambda r: self._on_request_failed(r, state))

    def _on_extra_page(self, page: Page, state: _RunState) -> None:
        if page is state.main_page:
            return
        state.guard.record(page.url or "about:blank", "popups and new windows are not allowed", source="popup")
        state.spawn(_close_quietly(page))

    def _is_main_frame(self, request: Request, state: _RunState) -> bool:
        try:
            return state.main_page is not None and request.frame == state.main_page.main_frame
        except PlaywrightError:
            return False

    async def _on_route(self, route: Route, request: Request, state: _RunState) -> None:
        url = request.url
        scheme = url.split(":", 1)[0].lower()
        try:
            main_nav = request.is_navigation_request() and self._is_main_frame(request, state)
            if scheme in LOCAL_SUBRESOURCE_SCHEMES:
                if main_nav:
                    state.guard.record(url, "top-level data/blob navigation is not allowed", source="navigation")
                    state.nav_blocked = sanitize_url(url)
                    await route.abort("blockedbyclient")
                else:
                    await route.continue_()
                return
            state.requests += 1
            if state.requests > MAX_REQUESTS_PER_TASK:
                state.guard.record(url, "request limit reached", resource_type=request.resource_type)
                await route.abort("blockedbyclient")
                return
            if scheme not in NETWORK_SCHEMES:
                state.guard.record(url, f"scheme '{scheme[:20]}' is not allowed", resource_type=request.resource_type)
                if main_nav:
                    state.nav_blocked = sanitize_url(url)
                await route.abort("blockedbyclient")
                return
            try:
                await state.guard.vet(url)
            except UnsafeURL as exc:
                state.guard.record(url, exc.message, resource_type=request.resource_type)
                if main_nav:
                    state.nav_blocked = sanitize_url(url)
                await route.abort("blockedbyclient")
                return
            await route.continue_()
        except PlaywrightError:
            with contextlib.suppress(PlaywrightError):
                await route.abort("blockedbyclient")

    def _on_navigated(self, frame: Frame, page: Page, state: _RunState) -> None:
        with contextlib.suppress(PlaywrightError):
            if frame == page.main_frame and frame.url.split(":", 1)[0] in NETWORK_SCHEMES:
                state.pages_visited += 1

    def _on_response(self, response: Response, state: _RunState) -> None:
        with contextlib.suppress(PlaywrightError):
            request = response.request
            if (request.is_navigation_request() and self._is_main_frame(request, state)
                    and response.headers.get(EGRESS_MARKER_HEADER) == "blocked"):
                state.nav_blocked = sanitize_url(response.url)

    def _on_request_failed(self, request: Request, state: _RunState) -> None:
        with contextlib.suppress(PlaywrightError):
            failure = request.failure or ""
            if ("ERR_TUNNEL_CONNECTION_FAILED" in failure and request.is_navigation_request()
                    and self._is_main_frame(request, state)):
                state.nav_blocked = sanitize_url(request.url)

    async def _on_download(self, download: Download, state: _RunState) -> None:
        name = clean_text(download.suggested_filename or "download", max_chars=200)
        if not state.allow_downloads:
            state.downloads.append(DownloadRecord(filename=name, url=sanitize_url(download.url), allowed=False))
            state.guard.record(download.url, "file downloads are not allowed", source="download")
            with contextlib.suppress(PlaywrightError):
                await download.cancel()
            return
        size: int | None = None
        try:
            path = await asyncio.wait_for(download.path(), timeout=30)
            if path is not None:
                size = await asyncio.to_thread(os.path.getsize, path)
        except (PlaywrightError, TimeoutError, OSError):
            size = None
        finally:
            # Downloads are observed, never kept: the file is removed immediately.
            with contextlib.suppress(PlaywrightError):
                await download.delete()
        state.downloads.append(DownloadRecord(filename=name, url=sanitize_url(download.url), allowed=True,
                                              size_bytes=size))

    async def _close_context(self, context: BrowserContext, state: _RunState) -> bool:
        for task in list(state.pending):
            task.cancel()
        if state.pending:
            await asyncio.gather(*state.pending, return_exceptions=True)
        try:
            await asyncio.wait_for(context.close(), timeout=CLOSE_TIMEOUT_S)
        except Exception:
            logger.warning("browser context did not close cleanly")
            return False
        return True

    # ------------------------------------------------------------------ actions
    async def _execute_all(self, page: Page, req: BrowserRunRequest, state: _RunState) -> None:
        for index, action in enumerate(req.actions):
            t0 = time.monotonic()
            state.actions_executed += 1
            try:
                detail = await self._dispatch(page, index, action, req, state)
                if state.page_crashed:
                    raise _crash_error(state)
                if state.nav_blocked:
                    raise ActionError("navigation_blocked",
                                      "The page navigated to a destination blocked by the egress policy.",
                                      ErrorClass.POLICY_BLOCKED)
            except BaseException as exc:
                code = exc.code if isinstance(exc, ActionError) else type(exc).__name__
                state.log.append(ActionLogEntry(index=index, type=action.type, status="error",
                                                duration_ms=_ms_since(t0), detail={"code": code}))
                raise
            state.log.append(ActionLogEntry(index=index, type=action.type, status="ok",
                                            duration_ms=_ms_since(t0), detail=detail))
        if req.expectations is not None and not req.expectations.empty:
            await self._check_expectations(page, req.expectations, state)

    async def _dispatch(self, page: Page, index: int, action: BrowserAction, req: BrowserRunRequest,
                        state: _RunState) -> dict[str, Any]:
        if isinstance(action, Navigate):
            return await self._navigate(page, action, state)
        if isinstance(action, Click):
            locator = await self._resolve(page, action.target, state)
            state.side_effect_started = True
            await self._guarded(locator.click(timeout=self._action_timeout(state)), "click")
            await self._settle(page, state)
            return {"target": action.target.describe()}
        if isinstance(action, Fill):
            locator = await self._resolve(page, action.target, state)
            state.side_effect_started = True
            await self._guarded(locator.fill(action.value, timeout=self._action_timeout(state)), "fill")
            return {"target": action.target.describe(), "value_chars": len(action.value)}
        if isinstance(action, Press):
            state.side_effect_started = state.side_effect_started or action.target is None
            if action.target is not None:
                locator = await self._resolve(page, action.target, state)
                state.side_effect_started = True
                await self._guarded(locator.press(action.key, timeout=self._action_timeout(state)), "press")
            else:
                await self._guarded(page.keyboard.press(action.key), "press")
            await self._settle(page, state)
            return {"key": action.key, **({"target": action.target.describe()} if action.target else {})}
        if isinstance(action, SelectOption):
            locator = await self._resolve(page, action.target, state)
            state.side_effect_started = True
            selected = await self._guarded(
                locator.select_option(action.value, timeout=self._action_timeout(state)), "select_option")
            if not selected:
                raise ActionError("option_not_found", "No option matches the requested value.",
                                  ErrorClass.INVALID_INPUT)
            return {"target": action.target.describe(), "selected": len(selected)}
        if isinstance(action, WaitFor):
            return await self._wait_for(page, action, state)
        if isinstance(action, Extract):
            return await self._extract(page, index, action, state)
        if isinstance(action, Screenshot):
            return await self._screenshot(page, action, req, state)
        raise ActionError("unsupported_action", "Unsupported browser action.", ErrorClass.INVALID_INPUT)

    async def _navigate(self, page: Page, action: Navigate, state: _RunState) -> dict[str, Any]:
        try:
            await state.guard.vet(action.url)
        except UnsafeURL as exc:
            state.guard.record(action.url, exc.message, source="navigation")
            raise ActionError("navigation_blocked", f"Navigation blocked by the egress policy: {exc.message}",
                              ErrorClass.POLICY_BLOCKED) from exc
        blocked_before = state.guard.blocked_total
        try:
            response = await page.goto(action.url, wait_until="domcontentloaded",
                                       timeout=state.remaining_ms(self._navigation_timeout_ms()))
        except PlaywrightTimeoutError as exc:
            raise ActionError("navigation_timeout", "The page did not load in time.", ErrorClass.TIMEOUT) from exc
        except PlaywrightError as exc:
            message = str(exc)
            if "Download is starting" in message:
                if not state.allow_downloads:
                    raise ActionError("download_blocked", "The page triggered a file download, which is not allowed.",
                                      ErrorClass.POLICY_BLOCKED) from exc
                return {"url": sanitize_url(action.url), "download": True}
            if state.nav_blocked or (state.guard.blocked_total > blocked_before and (
                    "ERR_BLOCKED_BY_CLIENT" in message or "ERR_TUNNEL_CONNECTION_FAILED" in message)):
                raise ActionError("navigation_blocked",
                                  "Navigation was blocked by the egress policy (redirect or disallowed destination).",
                                  ErrorClass.POLICY_BLOCKED) from exc
            if "has been closed" in message or "Target closed" in message:
                raise
            match = _NET_ERROR.search(message)
            reason = f" ({match.group(1)})" if match else ""
            raise ActionError("navigation_failed", f"The page could not be loaded{reason}.",
                              ErrorClass.NETWORK_ERROR) from exc
        if response is not None and response.headers.get(EGRESS_MARKER_HEADER) == "blocked":
            state.nav_blocked = sanitize_url(response.url)
        with contextlib.suppress(PlaywrightError):
            await page.wait_for_load_state("load", timeout=state.remaining_ms(5_000))
        return {"url": sanitize_url(page.url), "status": response.status if response is not None else None}

    async def _wait_for(self, page: Page, action: WaitFor, state: _RunState) -> dict[str, Any]:
        timeout = state.remaining_ms(float(action.timeout_ms))
        if action.target is not None:
            try:
                await self._resolve(page, action.target, state, timeout_ms=timeout, require_unique=False)
            except ActionError as exc:
                if exc.code != "target_not_found":
                    raise
                raise ActionError("wait_timeout", "The awaited element did not appear in time.",
                                  ErrorClass.TIMEOUT) from exc
            return {"condition": "target", "target": action.target.describe()}
        if action.url_contains is not None:
            if not await _poll(lambda: action.url_contains in page.url, timeout):
                raise ActionError("wait_timeout", "The page URL did not change as expected in time.",
                                  ErrorClass.TIMEOUT)
            return {"condition": "url_contains"}
        try:
            await page.get_by_text(action.text or "").first.wait_for(state="visible", timeout=timeout)
        except PlaywrightTimeoutError as exc:
            raise ActionError("wait_timeout", "The awaited text did not appear in time.", ErrorClass.TIMEOUT) from exc
        return {"condition": "text"}

    async def _extract(self, page: Page, index: int, action: Extract, state: _RunState) -> dict[str, Any]:
        locator = (await self._resolve(page, action.target, state) if action.target is not None
                   else page.locator("body"))
        timeout = self._action_timeout(state)
        if action.mode == "text":
            raw = await self._guarded(locator.inner_text(timeout=timeout), "extract")
        elif action.mode == "aria":
            raw = _mark_indentation(await self._guarded(locator.aria_snapshot(timeout=timeout), "extract"))
        else:
            raw = await self._guarded(locator.evaluate(OUTLINE_JS, OUTLINE_MAX_NODES, timeout=timeout), "extract")
        raw = raw if isinstance(raw, str) else ""
        budget = max(0, MAX_TOTAL_EXTRACT_CHARS - state.extract_chars)
        limit = min(action.max_chars, budget)
        content = clean_text(raw, max_chars=limit) if limit > 0 else ""
        state.extract_chars += min(len(raw), limit)
        state.extracts.append(ExtractResult(
            index=index, mode=action.mode, target=action.target.describe() if action.target else None,
            content=content, chars=len(content), truncated=len(raw) > limit))
        return {"mode": action.mode, "chars": len(content)}

    async def _screenshot(self, page: Page, action: Screenshot, req: BrowserRunRequest, state: _RunState
                          ) -> dict[str, Any]:
        if len(state.screenshots) >= MAX_SCREENSHOTS:
            raise ActionError("screenshot_limit", f"At most {MAX_SCREENSHOTS} screenshots per browser task.",
                              ErrorClass.INVALID_INPUT)
        data = await self._guarded(page.screenshot(full_page=action.full_page, type="png",
                                                   timeout=self._action_timeout(state), animations="disabled",
                                                   caret="hide"), "screenshot")
        if len(data) > MAX_SCREENSHOT_BYTES:
            raise ActionError("screenshot_too_large", "The screenshot exceeds the allowed size.",
                              ErrorClass.INVALID_INPUT)
        key = f"tenants/{req.tenant_id}/browser/{req.browser_task_id}/{len(state.screenshots) + 1}.png"
        try:
            await self.storage.put_bytes(key, data, "image/png")
        except Exception as exc:
            logger.warning("screenshot upload failed", exc_info=True)
            raise ActionError("artifact_storage_failed", "The screenshot could not be stored.",
                              ErrorClass.TRANSIENT) from exc
        state.screenshots.append(key)
        return {"key": key, "bytes": len(data), "full_page": action.full_page}

    async def _check_expectations(self, page: Page, expected: Expectations, state: _RunState) -> None:
        timeout = state.remaining_ms(EXPECT_TIMEOUT_MS)
        if expected.url_contains is not None:
            needle = expected.url_contains
            satisfied = await _poll(lambda: needle in page.url, timeout)
            state.checks.append(ExpectationCheck(kind="url_contains", expected=needle, satisfied=satisfied,
                                                 observed=sanitize_url(page.url, keep_query=True, max_chars=500)))
        if expected.text is not None:
            try:
                await page.get_by_text(expected.text).first.wait_for(state="visible", timeout=timeout)
                satisfied = True
            except PlaywrightError:
                satisfied = False
            state.checks.append(ExpectationCheck(kind="text", expected=expected.text, satisfied=satisfied))

    # ------------------------------------------------------------------ locating
    async def _resolve(self, page: Page, target: Target, state: _RunState, *, timeout_ms: float | None = None,
                       require_unique: bool = True) -> Locator:
        strategies = [s for s in state.locator_order if target.has(s)]
        deadline = time.monotonic() + (timeout_ms if timeout_ms is not None else self._action_timeout(state)) / 1000
        while True:
            for strategy in strategies:
                locator = _locator(page, target, strategy).filter(visible=True)
                count = await locator.count()
                if count == 1:
                    return locator
                if count > 1:
                    if not require_unique:
                        return locator.first
                    raise ActionError(
                        "ambiguous_target",
                        f"{count} visible elements match the target ({strategy}: {target.describe()}); "
                        "refusing to guess. Make the target more specific.", ErrorClass.INVALID_INPUT)
            if time.monotonic() >= deadline:
                raise ActionError("target_not_found", f"No visible element matches the target ({target.describe()}).",
                                  ErrorClass.INVALID_INPUT)
            await asyncio.sleep(0.15)

    async def _guarded(self, awaitable: Any, action: str) -> Any:
        """Map Playwright's strict-mode violation (the DOM changed after resolution) to an
        ambiguity error instead of a generic failure."""
        try:
            return await awaitable
        except PlaywrightTimeoutError as exc:
            raise ActionError("action_timeout", f"The {action} action did not complete in time.",
                              ErrorClass.TIMEOUT) from exc
        except PlaywrightError as exc:
            if "strict mode violation" in str(exc):
                raise ActionError("ambiguous_target", "Several elements match the target; refusing to guess.",
                                  ErrorClass.INVALID_INPUT) from exc
            raise

    async def _settle(self, page: Page, state: _RunState) -> None:
        with contextlib.suppress(PlaywrightError):
            await page.wait_for_load_state("domcontentloaded", timeout=state.remaining_ms(5_000))

    # ------------------------------------------------------------------ observation
    async def _observe(self, page: Page, state: _RunState) -> _Observation:
        obs = _Observation()
        with contextlib.suppress(PlaywrightError):
            if page.is_closed():
                return obs
            url = page.url
            if url.split(":", 1)[0] in NETWORK_SCHEMES:
                obs.final_url = clean_text(_strip_fragment(url), max_chars=2048)
                with contextlib.suppress(Exception):
                    obs.final_url_allowed = await asyncio.wait_for(state.guard.is_allowed(url), OBSERVE_TIMEOUT_S)
        with contextlib.suppress(PlaywrightError, TimeoutError):
            obs.title = clean_text(await asyncio.wait_for(page.title(), OBSERVE_TIMEOUT_S), max_chars=300)
        with contextlib.suppress(PlaywrightError, TimeoutError):
            ready = await asyncio.wait_for(page.evaluate("document.readyState"), OBSERVE_TIMEOUT_S)
            obs.ready_state = ready if ready in ("loading", "interactive", "complete") else None
        with contextlib.suppress(PlaywrightError, TimeoutError):
            snapshot = await page.locator("body").aria_snapshot(timeout=OBSERVE_TIMEOUT_S * 1000)
            obs.aria_snapshot = clean_text(_mark_indentation(snapshot), max_chars=FINAL_ARIA_MAX_CHARS)
        return obs

    # ------------------------------------------------------------------ errors / timeouts
    def _classify_error(self, exc: PlaywrightError, handle: _BrowserHandle, state: _RunState
                        ) -> tuple[ActionError, bool]:
        if handle.disconnected or state.page_crashed:
            return _crash_error(state), True
        if isinstance(exc, PlaywrightTimeoutError):
            return ActionError("action_timeout", "A browser action did not complete in time.",
                               ErrorClass.TIMEOUT), False
        message = str(exc)
        if "has been closed" in message or "Target closed" in message:
            return ActionError("page_closed", "The page was closed unexpectedly.", ErrorClass.TRANSIENT), False
        return ActionError("action_failed", "A browser action failed.", ErrorClass.TRANSIENT), False

    def _action_timeout(self, state: _RunState) -> float:
        return state.remaining_ms(float(self.settings.browser_action_timeout_ms))

    def _navigation_timeout_ms(self) -> float:
        return float(max(self.settings.browser_action_timeout_ms * 2, 10_000))


# ---------------------------------------------------------------------------- helpers
def _locator(page: Page, target: Target, strategy: str) -> Locator:
    if strategy == "role":
        role: Any = target.role
        if target.name is not None:
            return page.get_by_role(role, name=target.name, exact=target.exact)
        return page.get_by_role(role)
    if strategy == "label":
        return page.get_by_label(target.label or "", exact=target.exact)
    if strategy == "text":
        return page.get_by_text(target.text or "", exact=target.exact)
    if strategy == "test_id":
        return page.get_by_test_id(target.test_id or "")
    return page.locator(f"css={target.css}")


def _crash_error(state: _RunState) -> ActionError:
    if state.page_crashed:
        return ActionError("page_crashed", "The page crashed.", ErrorClass.TOOL_UNAVAILABLE)
    return ActionError("browser_crashed", "The browser stopped unexpectedly.", ErrorClass.TOOL_UNAVAILABLE)


async def _poll(predicate: Any, timeout_ms: float) -> bool:
    deadline = time.monotonic() + timeout_ms / 1000
    while True:
        with contextlib.suppress(PlaywrightError):
            if predicate():
                return True
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(0.1)


async def _close_quietly(page: Page) -> None:
    with contextlib.suppress(PlaywrightError):
        await page.close()


def _mark_indentation(snapshot: str) -> str:
    """Stored text is whitespace-normalized; keep the aria tree depth visible as '·' marks."""
    lines = []
    for line in snapshot.splitlines():
        stripped = line.lstrip(" ")
        depth = (len(line) - len(stripped)) // 2
        lines.append("·" * depth + stripped)
    return "\n".join(lines)


def _strip_fragment(url: str) -> str:
    return url.split("#", 1)[0]


def _ms_since(t0: float) -> int:
    return int((time.monotonic() - t0) * 1000)
