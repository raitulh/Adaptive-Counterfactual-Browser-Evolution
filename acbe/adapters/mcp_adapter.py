"""
MCP (Model Context Protocol) adapter (Section 2). Wraps an already-connected
MCP client session and calls a named tool (typically a "decide_next_action"
or similar tool exposed by an MCP-based agent server) once per step.

    from acbe.adapters import MCPAdapter
    agent = MCPAdapter(session, tool_name="decide_next_action")

Not exercised by the bundled test suite; requires an ``mcp``-compatible
client session (``session.call_tool(name, arguments) -> result``).
"""

from __future__ import annotations

import json
from typing import Any, List

from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.core.types import ActionRecord, ObservedState, action_record_from_dict


class MCPAdapter(AgentAdapter):
    name = "mcp"

    def __init__(self, session: Any, tool_name: str = "decide_next_action"):
        self.session = session
        self.tool_name = tool_name

    async def plan(self, *, goal: str, observation: ObservedState, history: List[ActionRecord]) -> ActionRecord:
        arguments = {
            "goal": goal,
            "observation": observation.to_dict(),
            "history": [a.to_dict() for a in history],
        }
        result = await self.session.call_tool(self.tool_name, arguments)
        content = getattr(result, "content", result)
        if isinstance(content, list) and content:
            content = content[0]
        text = getattr(content, "text", content)
        action = json.loads(text) if isinstance(text, str) else text
        if action is None:
            raise AgentFinished("MCP tool did not return an action.")
        return action_record_from_dict(action)
