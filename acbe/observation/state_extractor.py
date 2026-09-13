"""
Turns a full-fidelity ``RawBrowserState`` into the small, LLM-friendly
``ObservedState`` the spec describes in Section 4, and avoids re-sending
observations that have not meaningfully changed.
"""

from __future__ import annotations

import hashlib
import json
from typing import Optional

from acbe.browser.base import RawBrowserState
from acbe.core.types import ObservedState

MAX_VISIBLE_ELEMENTS = 12


def _state_hash(url: str, page_type: str, element_ids: list) -> str:
    payload = json.dumps({"url": url, "page_type": page_type, "elements": sorted(element_ids)}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _estimate_uncertainty(raw: RawBrowserState, recent_action_failed: bool) -> float:
    """A cheap, dependency-free uncertainty heuristic.

    Real deployments can swap this for a calibrated model; the important
    architectural property is that *something* produces this number, and
    everything downstream (adaptive observation depth, reasoning budget,
    model routing) reads it rather than re-deriving it ad hoc.
    """
    score = 0.15
    if not raw.elements:
        score += 0.35
    if len(raw.elements) > 25:
        score += 0.15
    if raw.page_type == "unknown":
        score += 0.2
    if recent_action_failed:
        score += 0.3
    return max(0.0, min(1.0, score))


class StateExtractor:
    """Stateful across a single task run: remembers the last hash so it can
    report ``state_change=False`` (and callers can skip re-sending context)
    when nothing meaningful happened.
    """

    def __init__(self) -> None:
        self._last_hash: Optional[str] = None

    def extract(
        self,
        raw: RawBrowserState,
        *,
        goal: str,
        recent_action: Optional[str] = None,
        recent_action_failed: bool = False,
        active_element: Optional[str] = None,
    ) -> ObservedState:
        element_names = [
            e.get("accessible_name") or e.get("visible_text") or e.get("element_id", "?")
            for e in raw.elements
        ]
        element_ids = [e.get("element_id", n) for e, n in zip(raw.elements, element_names)]
        h = _state_hash(raw.url, raw.page_type, element_ids)
        changed = h != self._last_hash
        self._last_hash = h

        return ObservedState(
            url=raw.url,
            page_type=raw.page_type,
            goal=goal,
            visible_elements=element_names[:MAX_VISIBLE_ELEMENTS],
            active_element=active_element,
            recent_action=recent_action,
            state_change=changed,
            uncertainty=_estimate_uncertainty(raw, recent_action_failed),
            state_hash=h,
            raw_element_count=len(raw.elements),
        )

    def reset(self) -> None:
        self._last_hash = None
