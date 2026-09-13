from __future__ import annotations

import inspect
from typing import Callable, List, Union

from acbe.core.types import ActionRecord, LocatorStrategy, ObservedState, action_record_from_dict, new_id
from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.experiments.runner import TaskStep


class FunctionAgent(AgentAdapter):
    """Wraps any plain Python callable as an ACBE agent.

    ``fn(goal, observation, history) -> ActionRecord | dict``

    This is the simplest possible way to plug in "a custom Python agent"
    (Section 2): no base class to subclass, no framework to install.
    """

    name = "function"

    def __init__(self, fn: Callable[[str, ObservedState, List[ActionRecord]], Union[ActionRecord, dict]]):
        self.fn = fn

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        result = self.fn(goal, observation, history)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, ActionRecord):
            return result
        return action_record_from_dict(result)


class ScriptedAgent(AgentAdapter):
    """A deterministic agent that replays a fixed list of steps.

    Useful as a zero-dependency default (demos, tests, CI) and as a
    reference implementation for wiring up a real planner: swap ``plan()``
    for a call into an LLM via ``acbe.adapters.ollama_adapter`` or
    ``acbe.adapters.openai_compatible_adapter`` and keep everything else.
    """

    name = "scripted"

    def __init__(self, steps: List[TaskStep], locator_strategy: LocatorStrategy = LocatorStrategy.ROLE_NAME):
        self._steps = list(steps)
        self._index = 0
        self.locator_strategy = locator_strategy

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        if self._index >= len(self._steps):
            raise AgentFinished("ScriptedAgent has no remaining steps.")
        step = self._steps[self._index]
        self._index += 1
        return ActionRecord(
            action_id=new_id("act"),
            action_type=step.action_type,
            target_description=step.target_description,
            locator_strategy=self.locator_strategy,
            params=step.params,
        )
