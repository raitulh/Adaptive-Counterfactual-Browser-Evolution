"""
CrewAI adapter (Section 2). CrewAI's ``Crew.kickoff()`` is synchronous and
runs a whole multi-agent crew rather than a single step, so this adapter
treats one ``kickoff()`` call as producing the *next action* -- suitable
for a crew whose final task is "decide and emit exactly one browser
action". Not exercised by the bundled test suite; requires the optional
``crewai`` package.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, List

from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.core.types import ActionRecord, ObservedState, action_record_from_dict


class CrewAIAdapter(AgentAdapter):
    name = "crewai"

    def __init__(self, crew: Any):
        self.crew = crew

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        inputs = {
            "goal": goal,
            "observation": observation.to_dict(),
            "history": [a.to_dict() for a in history],
        }
        result = await asyncio.to_thread(self.crew.kickoff, inputs=inputs)
        raw = getattr(result, "raw", result)
        action = json.loads(raw) if isinstance(raw, str) else raw
        if action is None:
            raise AgentFinished("Crew did not return an action.")
        return action_record_from_dict(action)
