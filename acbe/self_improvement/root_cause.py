from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Tuple

from acbe.core.types import DataclassMixin
from acbe.failure.fingerprint import FailureFingerprint

# failure_type -> (human-readable causal narrative, recommended locator family)
_CAUSE_NARRATIVES: Dict[str, Tuple[str, List[str]]] = {
    "WRONG_ELEMENT": (
        "Accessibility/DOM information was ignored; the strategy relied on visual/text "
        "similarity alone, which does not disambiguate look-alike elements.",
        ["role_name", "dom_role", "semantic_search"],
    ),
    "WRONG_SEQUENCE": (
        "Individual actions were correct but the environment enforces an order that "
        "the strategy did not track.",
        ["role_name", "verify_before_click"],
    ),
    "STATE_MISUNDERSTANDING": (
        "The agent assumed the UI was already interactive without confirming readiness "
        "(a dynamic element had not finished rendering/responding).",
        ["verify_before_click", "role_name"],
    ),
    "MISSING_INFORMATION": (
        "A precondition or required value was not established before the action was attempted.",
        ["role_name", "dom_role"],
    ),
    "PAGE_CHANGED": (
        "The observation used to plan the action was stale by the time the action executed.",
        ["role_name", "dom_role"],
    ),
    "CONTEXT_FAILURE": (
        "An overlay/interstitial (e.g. a popup) was not accounted for before acting.",
        ["role_name", "dom_role"],
    ),
    "ENVIRONMENT_FAILURE": (
        "The target resource/route was assumed valid without checking first.",
        ["role_name", "dom_role"],
    ),
    "VERIFICATION_FAILURE": (
        "The chosen verification method does not match how this environment signals task "
        "completion (e.g. checking the URL when completion is only reflected in app state).",
        ["role_name", "dom_role"],
    ),
}
_DEFAULT_NARRATIVE = ("Root cause not yet characterized for this failure category.", ["role_name"])


@dataclass
class RootCauseAnalysis(DataclassMixin):
    fingerprint_id: str
    failure_type: str
    likely_cause: str
    recommended_family: List[str]
    confidence: float


class RootCauseAnalyzer:
    """Identifies the underlying cause of a verified failure instead of
    just retrying the same action (Section 3)."""

    def analyze(self, fingerprint: FailureFingerprint) -> RootCauseAnalysis:
        cause, family = _CAUSE_NARRATIVES.get(fingerprint.failure_type, _DEFAULT_NARRATIVE)
        confidence = round(max(0.0, min(1.0, 1.0 - fingerprint.uncertainty)), 3)
        return RootCauseAnalysis(
            fingerprint_id=fingerprint.fingerprint_id,
            failure_type=fingerprint.failure_type,
            likely_cause=cause,
            recommended_family=family,
            confidence=confidence,
        )
