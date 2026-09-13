"""
Universal Agent Integration (Section 2).

Every framework adapter (custom Python agent, LangGraph, LangChain, CrewAI,
MCP, ...) ultimately has to answer one question at each step: "given the
goal, what I can currently see, and what I've already tried, what should I
do next?". That's the entire surface area ACBE needs from an agent.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List

from acbe.core.types import ActionRecord, ObservedState


class AgentFinished(Exception):
    """Raised by ``AgentAdapter.plan()`` to signal "nothing left to do".

    Note: this is deliberately *not* the built-in ``StopIteration``.
    Raising ``StopIteration`` from inside a coroutine gets converted into a
    confusing ``RuntimeError`` when it propagates out (PEP 479), so every
    adapter in this codebase raises ``AgentFinished`` instead.
    """


class AgentAdapter(ABC):
    name: str = "base"

    @abstractmethod
    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        """Return the next action to take. Raise ``AgentFinished`` when the
        agent believes the goal is already satisfied and there is nothing
        left to do."""
