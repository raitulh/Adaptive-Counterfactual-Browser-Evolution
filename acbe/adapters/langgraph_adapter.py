"""
LangGraph adapter (Section 2) -- activates once ``langgraph`` is installed.

    from acbe.adapters import LangGraphAdapter
    agent = LangGraphAdapter(compiled_graph)

The compiled graph is expected to accept a state dict with ``goal``,
``observation`` and ``history`` keys and return a state dict containing an
``action`` key shaped like ``ActionRecord``'s fields. This mirrors the most
common LangGraph "agent-as-a-graph" pattern without requiring ACBE to
depend on any particular graph topology.

Not exercised by the bundled test suite (it requires the optional
``langgraph`` package); import errors are deferred to first use so the rest
of ACBE stays fully usable without it installed.
"""

from __future__ import annotations

from typing import Any, List

from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.core.types import ActionRecord, ObservedState, action_record_from_dict


class LangGraphAdapter(AgentAdapter):
    name = "langgraph"

    def __init__(self, compiled_graph: Any):
        self.graph = compiled_graph

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        state = {
            "goal": goal,
            "observation": observation.to_dict(),
            "history": [a.to_dict() for a in history],
        }
        if hasattr(self.graph, "ainvoke"):
            result = await self.graph.ainvoke(state)
        elif hasattr(self.graph, "invoke"):
            import asyncio
            result = await asyncio.to_thread(self.graph.invoke, state)
        else:
            raise TypeError("compiled_graph must expose invoke()/ainvoke().")

        action = result.get("action") if isinstance(result, dict) else None
        if action is None:
            raise AgentFinished("LangGraph run did not return an 'action'.")
        if isinstance(action, ActionRecord):
            return action
        return action_record_from_dict(action)
