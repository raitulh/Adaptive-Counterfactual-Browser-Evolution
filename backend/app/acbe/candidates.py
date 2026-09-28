"""Counterfactual candidate generation: failure pattern → bounded StrategyConfig *patch*.

Rules are deterministic ("had verification waited longer, would it have passed?",
"had the planner resolved the contact first, would the argument have been valid?").
A candidate can only turn the knobs ``StrategyConfig`` exposes; it is validated
against the schema *and* against safety rules:

* planner hints are sanitised, single-line, length-limited and may not contain
  language about approvals, permissions, policy, credentials or instructions to
  ignore/bypass anything (so a hint can never argue the agent out of a safeguard);
* retry tuning only applies to non-destructive tools (``read``/``write``);
* read-back tuning only applies to registered tools.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from acbe.failure.taxonomy import FailureType

from app.acbe.analysis import FailurePattern
from app.acbe.runtime import ReadbackTuning, StrategyConfig, ToolRetryTuning
from app.agents.schemas import VerificationPolicy
from app.common.enums import ErrorClass, PermissionLevel
from app.tools.registry import get_tool_registry

MAX_HINT_CHARS = 200
MAX_HINTS = 10
RETRYABLE_CLASSES = frozenset({ErrorClass.TIMEOUT.value, ErrorClass.NETWORK_ERROR.value, ErrorClass.TRANSIENT.value,
                               ErrorClass.TOOL_UNAVAILABLE.value})
RETRY_TUNABLE_LEVELS = frozenset({PermissionLevel.READ.value, PermissionLevel.WRITE.value})
PREFERRED_LOCATOR_ORDER: list[str] = ["role", "label", "test_id", "text", "css"]

_UNSAFE_WORDS = re.compile(
    r"(approv|permission|permit|polic|ignor|bypass|credential|password|passcode|secret|token|api[\s_-]?key|"
    r"override|disregard|disabl|circumvent|skip|without\s+(asking|confirm)|consent|authori[sz]|admin|sudo|"
    r"jailbreak|system\s+prompt|instruction)", re.IGNORECASE)
_UNSAFE_MARKUP = re.compile(r"(https?://|www\.|`|\{\{|\}\}|<[a-z/]|\$ref)", re.IGNORECASE)


class UnsafeCandidate(ValueError):
    """A proposed strategy change violates the safety rules for ACBE candidates."""


def sanitize_hint(text: str) -> str:
    """Normalise a planner hint or raise ``UnsafeCandidate``."""
    cleaned = " ".join("".join(ch if ch.isprintable() else " " if ch.isspace() else "" for ch in text).split())
    if not cleaned:
        raise UnsafeCandidate("empty hint")
    if len(cleaned) > MAX_HINT_CHARS:
        raise UnsafeCandidate(f"hint longer than {MAX_HINT_CHARS} characters")
    if _UNSAFE_WORDS.search(cleaned):
        raise UnsafeCandidate("hint mentions approvals, permissions, policy, credentials or overriding instructions")
    if _UNSAFE_MARKUP.search(cleaned):
        raise UnsafeCandidate("hint contains links, markup or template syntax")
    return cleaned


def validate_candidate_config(config: StrategyConfig) -> StrategyConfig:
    """Schema-validate and apply the ACBE safety rules; returns the normalised config."""
    config = StrategyConfig.model_validate(config.model_dump())
    hints = [sanitize_hint(h) for h in config.planner_hints]
    if len(hints) > MAX_HINTS:
        raise UnsafeCandidate(f"at most {MAX_HINTS} planner hints")
    registry = get_tool_registry()
    for tool_name in config.tool_retry:
        if not registry.has(tool_name):
            raise UnsafeCandidate(f"retry tuning for unknown tool '{tool_name}'")
        level = registry.get(tool_name).spec.permission_level.value
        if level not in RETRY_TUNABLE_LEVELS:
            raise UnsafeCandidate(f"retry tuning is not allowed for {level} tool '{tool_name}'")
    for tool_name in config.verification_readback:
        if not registry.has(tool_name):
            raise UnsafeCandidate(f"read-back tuning for unknown tool '{tool_name}'")
    return config.model_copy(update={"planner_hints": list(dict.fromkeys(hints))})


@dataclass(slots=True)
class CandidateProposal:
    scope: str
    failure_type: FailureType
    patch: StrategyConfig
    rationale: str


_CONTACT_TOOLS = frozenset({"gmail.send", "gmail.create_draft", "calendar.create_event"})
_RECIPIENT_WORDS = re.compile(r"(recipient|attendee|e-?mail|address|\bto\b)", re.IGNORECASE)


class CandidateGenerator:
    """Deterministic counterfactual rules per failure type. ``propose`` returns ``None`` when no
    rule applies or the change is already in effect (nothing new to learn)."""

    def propose(self, pattern: FailurePattern, active: StrategyConfig) -> CandidateProposal | None:
        if not pattern.learnable:
            return None
        proposal: CandidateProposal | None
        if pattern.failure_type == FailureType.VERIFICATION_FAILURE:
            proposal = self._readback(pattern, active)
        elif pattern.failure_type == FailureType.TOOL_FAILURE:
            proposal = self._retry(pattern, active)
        elif pattern.failure_type in (FailureType.PLANNING_FAILURE, FailureType.MISSING_INFORMATION):
            proposal = self._hint(pattern, active)
        elif pattern.failure_type == FailureType.WRONG_ELEMENT:
            proposal = self._locators(pattern, active)
        else:
            proposal = None
        if proposal is None:
            return None
        proposal.patch = validate_candidate_config(proposal.patch)
        return proposal

    def _readback(self, pattern: FailurePattern, active: StrategyConfig) -> CandidateProposal | None:
        tool = pattern.tool_name
        if not tool or not get_tool_registry().has(tool):
            return None
        defaults = VerificationPolicy()
        current = active.verification_readback.get(tool) or ReadbackTuning(
            attempts=defaults.readback_attempts, delay_ms=defaults.readback_delay_ms)
        tuned = ReadbackTuning(attempts=min(10, current.attempts + 2), delay_ms=max(current.delay_ms, 250))
        if tuned == current:
            return None
        return CandidateProposal(
            scope=f"tool:{tool}", failure_type=pattern.failure_type,
            patch=StrategyConfig(verification_readback={tool: tuned}),
            rationale=(f"{pattern.tasks} task(s) failed read-back verification of {tool} ({pattern.error_code}). "
                       f"Counterfactual: verify with {tuned.attempts} read-back attempts "
                       f"(was {current.attempts}) at {tuned.delay_ms} ms base delay."))

    def _retry(self, pattern: FailurePattern, active: StrategyConfig) -> CandidateProposal | None:
        tool = pattern.tool_name
        if not tool or pattern.error_class not in RETRYABLE_CLASSES or not get_tool_registry().has(tool):
            return None
        spec = get_tool_registry().get(tool).spec
        if spec.permission_level.value not in RETRY_TUNABLE_LEVELS:
            return None
        current = active.tool_retry.get(tool) or ToolRetryTuning(
            max_attempts=spec.retry_policy.max_attempts, base_delay_seconds=spec.retry_policy.base_delay_seconds)
        tuned = ToolRetryTuning(max_attempts=min(5, current.max_attempts + 1),
                                base_delay_seconds=min(60.0, max(1.0, current.base_delay_seconds * 2)))
        if tuned == current:
            return None
        return CandidateProposal(
            scope=f"tool:{tool}", failure_type=pattern.failure_type,
            patch=StrategyConfig(tool_retry={tool: tuned}),
            rationale=(f"{pattern.tasks} task(s) failed with {pattern.error_class} on {tool}. Counterfactual: "
                       f"{tuned.max_attempts} attempts (was {current.max_attempts}) with "
                       f"{tuned.base_delay_seconds:g}s base backoff."))

    def _hint(self, pattern: FailurePattern, active: StrategyConfig) -> CandidateProposal | None:
        tool = pattern.tool_name or ""
        if tool in _CONTACT_TOOLS and _RECIPIENT_WORDS.search(pattern.sample_message):
            hint = "Always resolve people with contacts.lookup before using their e-mail address."
        elif pattern.failure_type == FailureType.MISSING_INFORMATION:
            hint = "Look up names with contacts.lookup and ask the user for details that are still unknown."
        elif tool.startswith("calendar."):
            hint = "Choose meeting times with calendar.find_free_slots instead of guessing them."
        elif tool and get_tool_registry().has(tool):
            hint = f"Check that every argument for {tool} matches its input schema before using it."
        else:
            return None
        hint = sanitize_hint(hint)
        if hint in active.planner_hints or len(active.planner_hints) >= MAX_HINTS:
            return None
        return CandidateProposal(
            scope="planner", failure_type=pattern.failure_type, patch=StrategyConfig(planner_hints=[hint]),
            rationale=(f"{pattern.tasks} task(s) failed with {pattern.error_code} on {tool or 'planning'}. "
                       f"Counterfactual: planner hint “{hint}”."))

    def _locators(self, pattern: FailurePattern, active: StrategyConfig) -> CandidateProposal | None:
        if active.browser_locator_order == PREFERRED_LOCATOR_ORDER:
            return None
        return CandidateProposal(
            scope="browser", failure_type=pattern.failure_type,
            patch=StrategyConfig.model_validate({"browser_locator_order": PREFERRED_LOCATOR_ORDER}),
            rationale=(f"{pattern.tasks} browser task(s) hit {pattern.error_code}. Counterfactual: prefer "
                       "accessible role/label locators before text and CSS."))


def version_label(fingerprint: str, sequence: int) -> str:
    return f"acbe-{fingerprint[:8]}-{sequence}"[:80]
