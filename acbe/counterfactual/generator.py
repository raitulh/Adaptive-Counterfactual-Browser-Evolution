"""
Counterfactual Strategy Engine (Section 6).

Given a verified failure, asks: "what alternative actions could have
produced the desired state?" and returns several concretely different
candidate ``Strategy`` objects -- never just one, and never a repeat of the
exact thing that just failed.
"""

from __future__ import annotations

from typing import List

from acbe.failure.fingerprint import FailureFingerprint
from acbe.strategy.models import Strategy

# For a WRONG_ELEMENT failure the spec gives a worked example (Section 6):
# S1 semantic locator, S2 DOM role inspection, S3 visual grounding,
# S4 nearby-element analysis, S5 search page for target, S6 verify before click.
_WRONG_ELEMENT_CANDIDATES = [
    ("semantic_search", []),
    ("dom_role", []),
    ("visual_grounding", []),
    ("nearby_element", []),
    ("role_name", [{"type": "search_page_for_target"}]),
    ("verify_before_click", []),
]


class CounterfactualGenerator:
    def generate(self, failure: FailureFingerprint) -> List[Strategy]:
        ftype = failure.failure_type
        method = getattr(self, f"_gen_{ftype.lower()}", None)
        if method:
            return method(failure)
        return self._gen_default(failure)

    # -- per-failure-type generators --------------------------------------
    def _gen_wrong_element(self, failure: FailureFingerprint) -> List[Strategy]:
        return [
            Strategy.new(failure.failure_type, locator, parent_id=None,
                         extra_actions=extra, risk=0.15 if locator != "text_visual" else 0.5)
            for locator, extra in _WRONG_ELEMENT_CANDIDATES
        ]

    def _gen_wrong_sequence(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "enforce_sequence"}]),
            ("dom_role", [{"type": "enforce_sequence"}]),
            ("verify_before_click", [{"type": "enforce_sequence"}, {"type": "re_observe_between_steps"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e) for l, e in base]

    def _gen_state_misunderstanding(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("verify_before_click", [{"type": "wait_for_ready"}]),
            ("role_name", [{"type": "wait_for_ready"}, {"type": "poll_until_stable"}]),
            ("dom_role", [{"type": "wait_for_ready"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.15) for l, e in base]

    def _gen_missing_information(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "check_precondition"}, {"type": "satisfy_precondition_first"}]),
            ("dom_role", [{"type": "check_precondition"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.2) for l, e in base]

    def _gen_page_changed(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "re_observe_before_act"}]),
            ("dom_role", [{"type": "re_observe_before_act"}, {"type": "refresh_and_retry"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.25) for l, e in base]

    def _gen_context_failure(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "dismiss_overlay_first"}]),
            ("dom_role", [{"type": "dismiss_overlay_first"}, {"type": "verify_no_overlay"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.2) for l, e in base]

    def _gen_environment_failure(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "verify_target_exists_before_navigate"}]),
            ("dom_role", [{"type": "verify_target_exists_before_navigate"}, {"type": "fallback_route"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.3) for l, e in base]

    def _gen_verification_failure(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "alternate_verification_method", "method": "dom_verification"}]),
            ("dom_role", [{"type": "alternate_verification_method", "method": "state_based_verification"}]),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.2) for l, e in base]

    def _gen_default(self, failure: FailureFingerprint) -> List[Strategy]:
        base = [
            ("role_name", [{"type": "generic_retry_with_verification"}]),
            ("dom_role", [{"type": "generic_retry_with_verification"}]),
            ("verify_before_click", []),
        ]
        return [Strategy.new(failure.failure_type, l, extra_actions=e, risk=0.3) for l, e in base]
