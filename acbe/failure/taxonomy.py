"""
Failure taxonomy (Section 5).

The taxonomy is allowed to *evolve* (new categories can be registered) but
existing labels must never be silently renamed or reinterpreted, because
historical failure fingerprints reference them by name. ``FailureTaxonomy``
enforces that: registering a category twice with a different description
raises, and there is no "rename" operation -- only "add new" and
"deprecate" (mark old, keep readable).
"""

from __future__ import annotations

from enum import Enum
from typing import Dict


class FailureType(str, Enum):
    WRONG_ELEMENT = "WRONG_ELEMENT"
    WRONG_ACTION = "WRONG_ACTION"
    WRONG_SEQUENCE = "WRONG_SEQUENCE"
    STATE_MISUNDERSTANDING = "STATE_MISUNDERSTANDING"
    MISSING_INFORMATION = "MISSING_INFORMATION"
    PAGE_CHANGED = "PAGE_CHANGED"
    TOOL_FAILURE = "TOOL_FAILURE"
    PLANNING_FAILURE = "PLANNING_FAILURE"
    REASONING_FAILURE = "REASONING_FAILURE"
    VERIFICATION_FAILURE = "VERIFICATION_FAILURE"
    CONTEXT_FAILURE = "CONTEXT_FAILURE"
    TOKEN_BUDGET_FAILURE = "TOKEN_BUDGET_FAILURE"
    ENVIRONMENT_FAILURE = "ENVIRONMENT_FAILURE"


_BASE_DESCRIPTIONS: Dict[str, str] = {
    FailureType.WRONG_ELEMENT: "The agent acted on an element other than the intended target.",
    FailureType.WRONG_ACTION: "The agent chose an action type that could not achieve the goal.",
    FailureType.WRONG_SEQUENCE: "Correct actions were taken in an order the environment rejects.",
    FailureType.STATE_MISUNDERSTANDING: "The agent's model of the current UI state was incorrect.",
    FailureType.MISSING_INFORMATION: "A required value/precondition was absent when acting.",
    FailureType.PAGE_CHANGED: "The environment changed state independently of the agent's action.",
    FailureType.TOOL_FAILURE: "The underlying browser/tool call itself failed to execute.",
    FailureType.PLANNING_FAILURE: "The high-level plan could not lead to the goal even if executed perfectly.",
    FailureType.REASONING_FAILURE: "Step-level reasoning drew an incorrect conclusion from correct observations.",
    FailureType.VERIFICATION_FAILURE: "The verification step itself was wrong (false positive/negative).",
    FailureType.CONTEXT_FAILURE: "Necessary context (e.g. an overlay) was not accounted for.",
    FailureType.TOKEN_BUDGET_FAILURE: "The task ran out of allotted reasoning/token budget.",
    FailureType.ENVIRONMENT_FAILURE: "The target environment/resource was invalid or unreachable.",
}


class FailureTaxonomy:
    """Mutable, append-only registry of failure categories."""

    def __init__(self) -> None:
        self._descriptions: Dict[str, str] = dict(_BASE_DESCRIPTIONS)
        self._deprecated: set = set()

    def register(self, name: str, description: str) -> None:
        if name in self._descriptions and self._descriptions[name] != description:
            raise ValueError(
                f"Failure category '{name}' already exists with a different description. "
                "Historical labels cannot be redefined -- register a new, differently-named "
                "category instead."
            )
        self._descriptions[name] = description

    def deprecate(self, name: str) -> None:
        if name not in self._descriptions:
            raise KeyError(name)
        self._deprecated.add(name)

    def describe(self, name: str) -> str:
        return self._descriptions.get(name, "Unregistered failure category.")

    def is_known(self, name: str) -> bool:
        return name in self._descriptions

    def all_categories(self) -> Dict[str, str]:
        return dict(self._descriptions)
