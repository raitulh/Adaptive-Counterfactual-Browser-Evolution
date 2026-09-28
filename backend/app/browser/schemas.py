"""browser schemas: executor request/result and the observation payload stored for a step.

Everything captured from a page is *untrusted external content*: it is sanitized and
bounded here and never influences policy, tool authorization or verification rules.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.browser.actions import DEFAULT_LOCATOR_ORDER, BrowserAction, LocatorStrategy
from app.common.enums import ErrorClass

if TYPE_CHECKING:
    from app.browser.policy import BrowserEgressPolicy

MAX_BLOCKED_RECORDS = 50
FINAL_ARIA_MAX_CHARS = 8_000


class Expectations(BaseModel):
    """Post-conditions a side-effecting action is expected to produce (verification evidence)."""

    model_config = ConfigDict(extra="forbid")

    url_contains: str | None = Field(default=None, min_length=1, max_length=500)
    text: str | None = Field(default=None, min_length=1, max_length=300)

    @property
    def empty(self) -> bool:
        return self.url_contains is None and self.text is None


class BlockedRequest(BaseModel):
    url: str
    reason: str
    resource_type: str | None = None
    source: Literal["route", "proxy", "navigation", "download", "upload", "popup"] = "route"


class ActionLogEntry(BaseModel):
    index: int
    type: str
    status: Literal["ok", "error"]
    duration_ms: int
    detail: dict[str, Any] = Field(default_factory=dict)


class ExtractResult(BaseModel):
    index: int
    mode: str
    target: str | None = None
    content: str
    chars: int
    truncated: bool = False


class ExpectationCheck(BaseModel):
    kind: Literal["url_contains", "text"]
    expected: str
    satisfied: bool
    observed: str | None = None


class DownloadRecord(BaseModel):
    filename: str
    url: str
    allowed: bool
    size_bytes: int | None = None


class BrowserObservations(BaseModel):
    """What the worker hands back for a step (``TaskStep.output``). Also the output schema
    of the browser tools; before the worker finishes only ``browser_task_id`` is set."""

    browser_task_id: str
    status: str | None = None
    final_url: str | None = None
    final_url_allowed: bool | None = None
    title: str | None = None
    ready_state: str | None = None
    extracts: list[ExtractResult] = Field(default_factory=list)
    aria_snapshot: str | None = None
    screenshots: list[str] = Field(default_factory=list)
    blocked_requests: list[BlockedRequest] = Field(default_factory=list)
    blocked_total: int = 0
    downloads: list[DownloadRecord] = Field(default_factory=list)
    action_log: list[ActionLogEntry] = Field(default_factory=list)
    checks: list[ExpectationCheck] = Field(default_factory=list)
    pages_visited: int = 0
    actions_executed: int = 0
    duration_ms: int = 0
    error_code: str | None = None


class BrowserRunResult(BaseModel):
    ok: bool
    final_url: str | None = None
    final_url_allowed: bool = False
    title: str | None = None
    ready_state: str | None = None
    extracts: list[ExtractResult] = Field(default_factory=list)
    aria_snapshot: str | None = None
    screenshots: list[str] = Field(default_factory=list)
    blocked_requests: list[BlockedRequest] = Field(default_factory=list)
    blocked_total: int = 0
    downloads: list[DownloadRecord] = Field(default_factory=list)
    action_log: list[ActionLogEntry] = Field(default_factory=list)
    checks: list[ExpectationCheck] = Field(default_factory=list)
    pages_visited: int = 0
    actions_executed: int = 0
    duration_ms: int = 0
    # True once a click/fill/press/select_option was dispatched to the page.
    side_effect_started: bool = False
    # The browser or renderer died mid-run.
    crashed: bool = False
    error_code: str | None = None
    error_class: ErrorClass | None = None
    error_message: str | None = None

    @classmethod
    def failure(cls, code: str, message: str, error_class: ErrorClass, *, crashed: bool = False,
                side_effect_started: bool = False, duration_ms: int = 0) -> BrowserRunResult:
        return cls(ok=False, error_code=code, error_message=message, error_class=error_class, crashed=crashed,
                   side_effect_started=side_effect_started, duration_ms=duration_ms)

    def observations(self, browser_task_id: uuid.UUID | str, *, status: str) -> dict[str, Any]:
        obs = BrowserObservations(
            browser_task_id=str(browser_task_id), status=status, final_url=self.final_url,
            final_url_allowed=self.final_url_allowed, title=self.title, ready_state=self.ready_state,
            extracts=self.extracts, aria_snapshot=self.aria_snapshot, screenshots=self.screenshots,
            blocked_requests=self.blocked_requests, blocked_total=self.blocked_total, downloads=self.downloads,
            action_log=self.action_log, checks=self.checks, pages_visited=self.pages_visited,
            actions_executed=self.actions_executed, duration_ms=self.duration_ms, error_code=self.error_code)
        return obs.model_dump(mode="json")


@dataclass(slots=True)
class BrowserRunRequest:
    """One isolated execution: a fresh browser context, these actions, this egress policy."""

    browser_task_id: uuid.UUID
    tenant_id: uuid.UUID
    actions: list[BrowserAction]
    policy: BrowserEgressPolicy
    locator_order: tuple[LocatorStrategy, ...] = DEFAULT_LOCATOR_ORDER
    timeout_seconds: float | None = None
    expectations: Expectations | None = None
    allow_downloads: bool | None = None
    # Called once the isolated context is up (e.g. to mark the BrowserSession active).
    on_active: Callable[[], Awaitable[None]] | None = field(default=None, repr=False)
