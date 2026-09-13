"""
MockBrowserAdapter -- a deterministic, in-memory "sandbox browser" backend.

Why this exists
-----------------
The spec explicitly lists a "sandbox browser" as one of the future backends
(Section 3) and separately requires a sandbox/replay stage for every
candidate strategy *before* it is allowed to touch a real environment
(Sections 7, 12, 13). This adapter is that sandbox: it implements the same
``BrowserAdapter`` interface as ``PlaywrightBrowserAdapter`` but simulates a
small, configurable web app in memory, with deliberately injectable failure
modes (wrong-element traps, dynamic/flaky elements, required sequences,
popups, expiring pages, gated elements).

It is used for:
  * the bundled unit/integration tests (no real browser/network needed),
  * ACBE-Bench's synthetic task suite,
  * cheap "sandbox/replay" validation of counterfactual candidates before
    they are trusted against a real site.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from acbe.browser.base import BrowserAdapter, BrowserActionError, RawBrowserState
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, VerificationResult

WEAK_LOCATORS = {LocatorStrategy.TEXT_VISUAL, LocatorStrategy.VISUAL_GROUNDING}
ROBUST_LOCATORS = {
    LocatorStrategy.ROLE_NAME,
    LocatorStrategy.DOM_ROLE,
    LocatorStrategy.SEMANTIC_SEARCH,
    LocatorStrategy.NEARBY_ELEMENT,
}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip().lower())


@dataclass
class ElementSpec:
    element_id: str
    role: str
    accessible_name: str
    visible_text: str
    kind: str = "button"
    requires_flag: Optional[str] = None   # element only usable once this flag is set
    sets_flag: Optional[str] = None       # clicking it sets this flag
    dynamic: bool = False                 # needs a WAIT / verify-before-click to be usable


@dataclass
class PageSpec:
    page_id: str
    page_type: str
    elements: List[ElementSpec] = field(default_factory=list)
    traps: Dict[str, str] = field(default_factory=dict)       # decoy_id -> real target_id
    transitions: Dict[str, str] = field(default_factory=dict)  # element_id -> next page_id
    required_sequence: Optional[List[str]] = None              # element ids, in order
    popup_after_actions: Optional[int] = None
    popup_close_element_id: Optional[str] = None
    auto_expires_after: Optional[int] = None
    expired_page_id: Optional[str] = None


@dataclass
class EnvironmentSpec:
    env_id: str
    start_page: str
    pages: Dict[str, PageSpec]
    goal_state: str = ""


class MockBrowserAdapter(BrowserAdapter):
    name = "mock"

    def __init__(self, env: EnvironmentSpec):
        self.env = env
        self.current_page_id = env.start_page
        self.flags: Dict[str, bool] = {}
        self.page_action_count: Dict[str, int] = {}
        self.page_waited: Dict[str, bool] = {}
        self.popup_active: Dict[str, bool] = {}
        self.sequence_progress: Dict[str, int] = {}
        self.history: List[ActionRecord] = []
        self._started = False

    # -- lifecycle -----------------------------------------------------
    async def start(self) -> None:
        self._started = True

    async def close(self) -> None:
        self._started = False

    # -- helpers ---------------------------------------------------------
    def _page(self) -> PageSpec:
        return self.env.pages[self.current_page_id]

    def _find_element(self, description: str, locator_strategy: LocatorStrategy) -> Optional[ElementSpec]:
        """Resolve a target description to a concrete element.

        When the description is ambiguous (it matches more than one
        element -- i.e. a trap is present), weak locator strategies
        deterministically resolve to the decoy, exactly the way naive
        visual/text matching would in a real browser; robust strategies
        (role/DOM/semantic-based) resolve to the real target, because they
        have access to disambiguating accessibility/DOM information a
        purely visual/text match does not.
        """
        page = self._page()
        norm_desc = _norm(description)
        matches: List[ElementSpec] = [
            el for el in page.elements
            if norm_desc == _norm(el.visible_text) or norm_desc == _norm(el.accessible_name)
        ]
        if not matches:
            matches = [
                el for el in page.elements
                if norm_desc in _norm(el.visible_text) or norm_desc in _norm(el.accessible_name)
                or _norm(el.visible_text) in norm_desc or _norm(el.accessible_name) in norm_desc
            ]
        if not matches:
            return None
        if len(matches) == 1:
            return matches[0]

        decoy_ids = set(page.traps.keys())
        if locator_strategy in WEAK_LOCATORS:
            for el in matches:
                if el.element_id in decoy_ids:
                    return el
            return matches[0]
        for el in matches:
            if el.element_id not in decoy_ids:
                return el
        return matches[0]

    def _get_element(self, element_id: str) -> Optional[ElementSpec]:
        for el in self._page().elements:
            if el.element_id == element_id:
                return el
        return None

    async def observe(self) -> RawBrowserState:
        page = self._page()
        elements = []
        for el in page.elements:
            if el.requires_flag and not self.flags.get(el.requires_flag):
                continue
            elements.append({
                "element_id": el.element_id,
                "role": el.role,
                "accessible_name": el.accessible_name,
                "visible_text": el.visible_text,
                "kind": el.kind,
            })
        return RawBrowserState(
            url=f"mock://{self.env.env_id}/{page.page_id}",
            page_type=page.page_type,
            dom=f"<page id='{page.page_id}'/>",
            accessibility_tree=elements,
            elements=elements,
            extra={"popup_active": self.popup_active.get(page.page_id, False), "flags": dict(self.flags)},
        )

    def _maybe_spawn_popup(self, page: PageSpec, count: int) -> None:
        if page.popup_after_actions is not None and count == page.popup_after_actions:
            self.popup_active[page.page_id] = True

    def _maybe_expire(self, page: PageSpec, count: int) -> bool:
        if page.auto_expires_after is not None and count > page.auto_expires_after:
            if page.expired_page_id:
                self.current_page_id = page.expired_page_id
            return True
        return False

    async def act(self, action: ActionRecord) -> RawBrowserState:
        self.history.append(action)
        page = self._page()
        count = self.page_action_count.get(page.page_id, 0) + 1
        self.page_action_count[page.page_id] = count
        self._maybe_spawn_popup(page, count)

        if self._maybe_expire(page, count):
            raise BrowserActionError(
                "Page state changed unexpectedly (session/data went stale).",
                expected_state=f"page:{page.page_id}",
                actual_state=f"page:{self.current_page_id}",
                error_kind="PAGE_CHANGED",
            )

        if self.popup_active.get(page.page_id):
            target_is_popup_close = (
                action.action_type == ActionType.CLICK
                and page.popup_close_element_id
                and _norm(action.target_description) in (
                    _norm(self._get_element(page.popup_close_element_id).visible_text)
                    if self._get_element(page.popup_close_element_id) else ""
                )
            )
            if not target_is_popup_close:
                raise BrowserActionError(
                    "An unexpected popup is blocking interaction.",
                    expected_state="no blocking overlay",
                    actual_state="popup active",
                    error_kind="CONTEXT_FAILURE",
                )
            self.popup_active[page.page_id] = False
            return await self.observe()

        if action.action_type == ActionType.WAIT:
            self.page_waited[page.page_id] = True
            return await self.observe()

        if action.action_type == ActionType.NAVIGATE:
            target_page = action.params.get("page_id")
            if target_page not in self.env.pages:
                raise BrowserActionError(
                    f"Navigation target '{target_page}' does not exist.",
                    expected_state=f"page:{target_page}",
                    actual_state=f"page:{self.current_page_id}",
                    error_kind="ENVIRONMENT_FAILURE",
                )
            self.current_page_id = target_page
            self._maybe_spawn_popup(self._page(), 0)
            return await self.observe()

        if action.action_type in (ActionType.TYPE, ActionType.SELECT) and "value" not in action.params:
            raise BrowserActionError(
                "No value supplied for input/select action.",
                expected_state="value provided",
                actual_state="value missing",
                error_kind="MISSING_INFORMATION",
            )

        if action.action_type in (ActionType.CLICK, ActionType.TYPE, ActionType.SELECT, ActionType.HOVER):
            el = self._find_element(action.target_description, action.locator_strategy)
            if el is None:
                raise BrowserActionError(
                    f"No element matches '{action.target_description}'.",
                    expected_state=f"element matching '{action.target_description}'",
                    actual_state="not found",
                    error_kind="WRONG_ELEMENT",
                )

            if el.requires_flag and not self.flags.get(el.requires_flag):
                raise BrowserActionError(
                    f"Element '{el.element_id}' is not available until '{el.requires_flag}' is satisfied.",
                    expected_state=f"flag:{el.requires_flag}=true",
                    actual_state=f"flag:{el.requires_flag}={self.flags.get(el.requires_flag, False)}",
                    error_kind="MISSING_INFORMATION",
                )

            if el.dynamic and not self.page_waited.get(page.page_id):
                if action.locator_strategy != LocatorStrategy.VERIFY_BEFORE_CLICK:
                    raise BrowserActionError(
                        f"Element '{el.element_id}' is not yet interactive (dynamic UI).",
                        expected_state="element interactive",
                        actual_state="element still rendering/animating",
                        error_kind="STATE_MISUNDERSTANDING",
                    )
                self.page_waited[page.page_id] = True

            if page.required_sequence and el.element_id in page.required_sequence:
                expected_idx = self.sequence_progress.get(page.page_id, 0)
                actual_idx = page.required_sequence.index(el.element_id)
                if actual_idx != expected_idx:
                    raise BrowserActionError(
                        f"Steps performed out of order at '{el.element_id}'.",
                        expected_state=f"step {expected_idx}: {page.required_sequence[expected_idx]}",
                        actual_state=f"step {actual_idx}: {el.element_id}",
                        error_kind="WRONG_SEQUENCE",
                    )
                self.sequence_progress[page.page_id] = expected_idx + 1

            if el.element_id in page.traps:
                real_id = page.traps[el.element_id]
                raise BrowserActionError(
                    f"Clicked '{el.element_id}' instead of the intended target '{real_id}'.",
                    expected_state=f"click:{real_id}",
                    actual_state=f"click:{el.element_id} ({el.visible_text})",
                    error_kind="WRONG_ELEMENT",
                )

            if el.sets_flag:
                self.flags[el.sets_flag] = True

            if action.action_type == ActionType.CLICK and el.element_id in page.transitions:
                target_page_id = page.transitions[el.element_id]
                if target_page_id not in self.env.pages:
                    raise BrowserActionError(
                        f"Link '{el.element_id}' points to a route that does not exist.",
                        expected_state=f"page:{target_page_id}",
                        actual_state=f"page:{page.page_id}",
                        error_kind="ENVIRONMENT_FAILURE",
                    )
                self.current_page_id = target_page_id
                self._maybe_spawn_popup(self._page(), 0)

            return await self.observe()

        # scroll / keyboard / download / upload -> accepted no-ops in the sandbox
        return await self.observe()

    async def verify(self, expected_state: str) -> VerificationResult:
        actual = f"page:{self.current_page_id}"
        if expected_state.startswith("flag:"):
            _, rest = expected_state.split(":", 1)
            flag_name, _, flag_val = rest.partition("=")
            ok = str(self.flags.get(flag_name, False)).lower() == flag_val.lower()
            return VerificationResult(
                verified=ok, method="flag_check",
                expected_state=expected_state, actual_state=f"flag:{flag_name}={self.flags.get(flag_name, False)}",
                confidence=1.0,
            )
        ok = actual == expected_state or expected_state == self.env.goal_state and actual == expected_state
        return VerificationResult(
            verified=ok, method="page_id_match",
            expected_state=expected_state, actual_state=actual,
            confidence=1.0,
            detail="" if ok else "current page does not match expected goal state",
        )
