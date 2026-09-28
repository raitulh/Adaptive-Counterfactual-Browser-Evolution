"""Fake MCP server (Streamable HTTP) on ``httpx.MockTransport`` plus test helpers.

Shared by tests/unit/mcp and tests/integration/mcp (their conftest puts this directory on
``sys.path``).
"""

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

import httpx

from app.common.context import RequestContext
from app.common.enums import PermissionLevel, RiskLevel
from app.mcp.adapter import MCPToolBinding
from app.mcp.client import MCPConnectionManager
from app.mcp.policy import normalize_remote_tool
from app.organizations.schemas import OrganizationPolicy
from app.tools.base import ToolContext

PUBLIC_URL = "https://93.184.215.14/mcp"  # literal public IP: no DNS needed, passes the egress policy

ECHO_TOOL: dict[str, Any] = {
    "name": "echo",
    "title": "Echo",
    "description": "Return the given text.",
    "inputSchema": {
        "type": "object",
        "properties": {"text": {"type": "string", "maxLength": 100}},
        "required": ["text"],
        "additionalProperties": False,
    },
    "outputSchema": {
        "type": "object",
        "properties": {"text": {"type": "string"}, "length": {"type": "integer"}},
        "required": ["text", "length"],
    },
    "annotations": {"readOnlyHint": True},
}

ADD_NOTE_TOOL: dict[str, Any] = {
    "name": "add_note",
    "description": "Store a note.",
    "inputSchema": {
        "type": "object",
        "properties": {"title": {"type": "string", "minLength": 1}, "body": {"type": "string"}},
        "required": ["title"],
        "additionalProperties": False,
    },
    "outputSchema": {
        "type": "object",
        "properties": {"note_id": {"type": "string"}, "title": {"type": "string"}},
        "required": ["note_id", "title"],
    },
    "annotations": {"readOnlyHint": False, "destructiveHint": False},
}

PLAIN_WRITE_TOOL: dict[str, Any] = {
    "name": "send_message",
    "description": "Send a message (declares no outputSchema).",
    "inputSchema": {"type": "object", "properties": {"to": {"type": "string"}, "body": {"type": "string"}},
                    "required": ["to"]},
}

FAILING_TOOL: dict[str, Any] = {
    "name": "always_fails",
    "description": "Reports an error.",
    "inputSchema": {"type": "object", "properties": {}},
}

CallHandler = Callable[[str, dict[str, Any]], dict[str, Any] | Awaitable[dict[str, Any]]]


def default_tools() -> list[dict[str, Any]]:
    return copy.deepcopy([ECHO_TOOL, ADD_NOTE_TOOL, PLAIN_WRITE_TOOL, FAILING_TOOL])


class FakeMCPServer:
    """Implements initialize / notifications/initialized / tools/list / tools/call / DELETE."""

    def __init__(self, tools: list[dict[str, Any]] | None = None, *, mode: str = "json",
                 protocol_version: str = "2025-06-18", session_id: str | None = "sess-0001",
                 expected_auth: str | None = None) -> None:
        self.tools = tools if tools is not None else default_tools()
        self.mode = mode
        self.protocol_version = protocol_version
        self.session_id = session_id
        self.expected_auth = expected_auth
        self.requests: list[httpx.Request] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.deleted_sessions = 0
        self.delay: dict[str, float] = {}
        self.status_override: dict[str, int] = {}
        self.rpc_errors: dict[str, tuple[int, str]] = {}
        self.page_size: int | None = None
        self.call_handler: CallHandler | None = None
        self.notes: dict[str, str] = {}

    # ------------------------------------------------------------------ plumbing
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def http_client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=self.transport(), follow_redirects=False)

    def manager(self) -> MCPConnectionManager:
        return MCPConnectionManager(http_client=self.http_client())

    def bodies(self, method: str) -> list[dict[str, Any]]:
        out = []
        for request in self.requests:
            if request.method == "POST":
                body = json.loads(request.content)
                if body.get("method") == method:
                    out.append(body)
        return out

    def headers_for(self, method: str) -> list[httpx.Headers]:
        return [r.headers for r in self.requests
                if r.method == "POST" and json.loads(r.content).get("method") == method]

    def _reply(self, request_id: Any, *, result: Any = None, error: dict[str, Any] | None = None,
               headers: dict[str, str] | None = None) -> httpx.Response:
        message: dict[str, Any] = {"jsonrpc": "2.0", "id": request_id}
        if error is not None:
            message["error"] = error
        else:
            message["result"] = result
        if self.mode == "sse":
            progress = {"jsonrpc": "2.0", "method": "notifications/message",
                        "params": {"level": "info", "data": "working"}}
            server_request = {"jsonrpc": "2.0", "id": "srv-1", "method": "ping"}
            events = [
                ": keep-alive comment\n\n",
                "event: message\ndata: " + json.dumps(progress) + "\n\n",
                "event: message\ndata: " + json.dumps(server_request) + "\n\n",
                "event: message\ndata: not-json keep-alive\n\n",
                "id: 7\nevent: message\ndata: " + json.dumps(message) + "\n\n",
            ]
            return httpx.Response(200, content="".join(events).encode(),
                                  headers={"content-type": "text/event-stream", **(headers or {})})
        return httpx.Response(200, json=message, headers=headers or {})

    # ------------------------------------------------------------------ server
    async def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.expected_auth is not None and request.headers.get("authorization") != self.expected_auth:
            return httpx.Response(401)
        if request.method == "DELETE":
            self.deleted_sessions += 1
            return httpx.Response(200)
        body = json.loads(request.content)
        method = body.get("method")
        if method in self.delay:
            await asyncio.sleep(self.delay[method])
        if method in self.status_override:
            return httpx.Response(self.status_override[method], text="upstream says no")
        if "id" not in body:
            return httpx.Response(202)
        request_id = body["id"]
        if method in self.rpc_errors:
            code, message = self.rpc_errors[method]
            return self._reply(request_id, error={"code": code, "message": message})
        if method == "initialize":
            headers = {"Mcp-Session-Id": self.session_id} if self.session_id else {}
            return self._reply(request_id, result={
                "protocolVersion": self.protocol_version,
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "fake-mcp", "version": "0.0.1"},
            }, headers=headers)
        if self.session_id and request.headers.get("mcp-session-id") != self.session_id:
            return httpx.Response(400)
        if method == "tools/list":
            return self._reply(request_id, result=self._list_page(body.get("params") or {}))
        if method == "tools/call":
            params = body.get("params") or {}
            name, arguments = params.get("name"), params.get("arguments") or {}
            self.calls.append((name, arguments))
            result = await self._call(name, arguments)
            if result is None:
                return self._reply(request_id, error={"code": -32602, "message": f"Unknown tool: {name}"})
            return self._reply(request_id, result=result)
        return self._reply(request_id, error={"code": -32601, "message": "Method not found"})

    def _list_page(self, params: dict[str, Any]) -> dict[str, Any]:
        if self.page_size is None:
            return {"tools": self.tools}
        start = int(params.get("cursor") or 0)
        end = start + self.page_size
        page: dict[str, Any] = {"tools": self.tools[start:end]}
        if end < len(self.tools):
            page["nextCursor"] = str(end)
        return page

    async def _call(self, name: str, arguments: dict[str, Any]) -> dict[str, Any] | None:
        if self.call_handler is not None:
            outcome = self.call_handler(name, arguments)
            return await outcome if isinstance(outcome, Awaitable) else outcome
        if name == "echo":
            text = str(arguments.get("text", ""))
            return {"content": [{"type": "text", "text": text}],
                    "structuredContent": {"text": text, "length": len(text)}, "isError": False}
        if name == "add_note":
            note_id = f"note-{len(self.notes) + 1}"
            self.notes[note_id] = str(arguments.get("title"))
            return {"content": [{"type": "text", "text": f"saved {note_id}"}],
                    "structuredContent": {"note_id": note_id, "title": arguments.get("title")}}
        if name == "send_message":
            return {"content": [{"type": "text", "text": "sent"}]}
        if name == "always_fails":
            return {"content": [{"type": "text", "text": "Upstream API refused: quota exhausted"}],
                    "isError": True}
        return None


# ---------------------------------------------------------------------------- helpers
def binding_for(raw_tool: dict[str, Any], *, server_name: str = "demo",
                permission_level: PermissionLevel = PermissionLevel.HIGH_RISK_WRITE,
                risk_level: RiskLevel = RiskLevel.HIGH, tenant_id: uuid.UUID | None = None,
                timeout_seconds: float = 5.0, rate_limit_per_minute: int = 1000) -> MCPToolBinding:
    normalized = normalize_remote_tool(raw_tool, server_name)
    return MCPToolBinding(
        tenant_id=tenant_id or uuid.uuid4(), server_id=uuid.uuid4(), server_name=server_name,
        tool_id=uuid.uuid4(),
        remote_name=normalized.remote_name, qualified_name=normalized.qualified_name, title=normalized.title,
        description=normalized.description, input_schema=normalized.input_schema,
        output_schema=normalized.output_schema, annotations=normalized.annotations,
        permission_level=permission_level, risk_level=risk_level, requires_approval=True,
        schema_hash=normalized.schema_hash, timeout_seconds=timeout_seconds,
        rate_limit_per_minute=rate_limit_per_minute,
    )


def tool_context(tenant_id: uuid.UUID, user_id: uuid.UUID | None = None) -> ToolContext:
    ctx = RequestContext(user_id=user_id or uuid.uuid4(), tenant_id=tenant_id, role="owner",
                         permissions=frozenset())
    return ToolContext(ctx=ctx, task_id=uuid.uuid4(), step_id=uuid.uuid4(), step_key="step-1",
                       attempt_number=1, idempotency_key=f"idem-{uuid.uuid4().hex}",
                       services=None,  # type: ignore[arg-type]
                       org_policy=OrganizationPolicy())
