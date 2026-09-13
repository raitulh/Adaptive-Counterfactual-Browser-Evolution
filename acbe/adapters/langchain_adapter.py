"""
LangChain adapter (Section 2) -- wraps a LangChain ``AgentExecutor`` (or
anything exposing a compatible ``ainvoke({"input": ...}) -> {"output": ...}``
interface) as an ACBE ``AgentAdapter``.

    from acbe.adapters import LangChainAdapter
    agent = LangChainAdapter(agent_executor)

The executor's ``output`` is expected to be a JSON-shaped action dict (this
is easy to enforce with a LangChain output parser / structured-output tool).
Not exercised by the bundled test suite; requires the optional
``langchain`` package.
"""

from __future__ import annotations

import json
from typing import Any, List

from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.core.types import ActionRecord, ObservedState, action_record_from_dict


class LangChainAdapter(AgentAdapter):
    name = "langchain"

    def __init__(self, agent_executor: Any):
        self.executor = agent_executor

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        prompt = json.dumps({
            "goal": goal,
            "observation": observation.to_dict(),
            "history": [a.to_dict() for a in history],
        })
        if hasattr(self.executor, "ainvoke"):
            result = await self.executor.ainvoke({"input": prompt})
        elif hasattr(self.executor, "invoke"):
            import asyncio
            result = await asyncio.to_thread(self.executor.invoke, {"input": prompt})
        else:
            raise TypeError("agent_executor must expose invoke()/ainvoke().")

        raw = result.get("output", result) if isinstance(result, dict) else result
        action = json.loads(raw) if isinstance(raw, str) else raw
        if action is None:
            raise AgentFinished("LangChain executor did not return an action.")
        return action_record_from_dict(action)
