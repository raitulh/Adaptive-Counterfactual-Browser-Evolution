"""A small, real MCP server for local development (Streamable HTTP transport).

Exposes two harmless tools:

* ``echo`` — read-only; returns the text it was given (text + structured content).
* ``add_note`` — a write; stores a note in memory and returns structured output that
  matches its declared ``outputSchema`` (so AgentOS can verify the write).

Run::

    .venv/bin/python scripts/demo_mcp_server.py --port 8765 [--token SECRET] [--response-mode sse]

and register it in AgentOS (the host must be trusted because it is a private address)::

    MCP_ALLOWED_HOSTS=127.0.0.1
    POST /api/v1/mcp/servers {"name": "demo", "url": "http://127.0.0.1:8765/mcp",
                              "auth_header_value": "Bearer SECRET"}

Protocol notes: JSON-RPC 2.0 over HTTP POST to ``/mcp``; the server answers with
``application/json`` (or a single-event ``text/event-stream`` with ``--response-mode sse``),
issues an ``Mcp-Session-Id`` on ``initialize`` and requires it afterwards, accepts
``DELETE /mcp`` to end a session, and rejects cross-origin browser requests (DNS-rebinding
protection). It binds to 127.0.0.1 by default. Only the standard library, FastAPI and
uvicorn are used; nothing is imported from AgentOS.
"""

from __future__ import annotations

import argparse
import json
import secrets
import uuid
from datetime import UTC, datetime
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, Response

SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26")
LATEST_VERSION = "2025-06-18"
SERVER_INFO = {"name": "agentos-demo-mcp", "title": "AgentOS demo MCP server", "version": "1.0.0"}
LOCAL_ORIGINS = ("http://localhost", "http://127.0.0.1", "https://localhost", "https://127.0.0.1")

TOOLS: list[dict[str, Any]] = [
    {
        "name": "echo",
        "title": "Echo",
        "description": "Return the given text unchanged.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string", "minLength": 1, "maxLength": 1000,
                                    "description": "Text to echo back"}},
            "required": ["text"],
            "additionalProperties": False,
        },
        "outputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}, "length": {"type": "integer"}},
            "required": ["text", "length"],
        },
        "annotations": {"readOnlyHint": True, "openWorldHint": False},
    },
    {
        "name": "add_note",
        "title": "Add note",
        "description": "Store a short note in the demo server's memory and return its id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "minLength": 1, "maxLength": 200},
                "body": {"type": "string", "maxLength": 5000},
            },
            "required": ["title"],
            "additionalProperties": False,
        },
        "outputSchema": {
            "type": "object",
            "properties": {
                "note_id": {"type": "string"},
                "title": {"type": "string"},
                "created_at": {"type": "string"},
                "total_notes": {"type": "integer"},
            },
            "required": ["note_id", "title", "created_at"],
        },
        "annotations": {"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False,
                        "openWorldHint": False},
    },
]


class RpcError(Exception):
    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _tool_result(text: str, structured: dict[str, Any] | None = None, *, is_error: bool = False
                 ) -> dict[str, Any]:
    result: dict[str, Any] = {"content": [{"type": "text", "text": text}], "isError": is_error}
    if structured is not None:
        result["structuredContent"] = structured
    return result


class DemoServer:
    def __init__(self, *, token: str | None = None, response_mode: str = "json") -> None:
        self.token = token
        self.response_mode = response_mode
        self.sessions: dict[str, str] = {}
        self.notes: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------------ tools
    def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        if name == "echo":
            text = arguments.get("text")
            if not isinstance(text, str) or not text or len(text) > 1000:
                return _tool_result("'text' must be a non-empty string of at most 1000 characters",
                                    is_error=True)
            return _tool_result(text, {"text": text, "length": len(text)})
        if name == "add_note":
            title = arguments.get("title")
            body = arguments.get("body", "")
            if not isinstance(title, str) or not title or len(title) > 200 or not isinstance(body, str):
                return _tool_result("'title' must be a non-empty string of at most 200 characters",
                                    is_error=True)
            note_id = f"note_{secrets.token_hex(6)}"
            created_at = datetime.now(UTC).isoformat()
            self.notes[note_id] = {"title": title, "body": body[:5000], "created_at": created_at}
            structured = {"note_id": note_id, "title": title, "created_at": created_at,
                          "total_notes": len(self.notes)}
            return _tool_result(f"Saved note {note_id}", structured)
        raise RpcError(-32602, f"Unknown tool: {name[:100]}")

    # ------------------------------------------------------------------ JSON-RPC
    def dispatch(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": TOOLS}
        if method == "tools/call":
            name = params.get("name")
            arguments = params.get("arguments") or {}
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise RpcError(-32602, "Invalid params")
            return self.call_tool(name, arguments)
        raise RpcError(-32601, f"Method not found: {method[:100]}")

    def initialize(self, params: dict[str, Any]) -> tuple[dict[str, Any], str]:
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_VERSIONS else LATEST_VERSION
        session_id = uuid.uuid4().hex
        self.sessions[session_id] = version
        result = {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": SERVER_INFO,
            "instructions": "Demo server: 'echo' is read-only, 'add_note' stores a note in memory.",
        }
        return result, session_id


def _rpc_response(request_id: Any, *, result: Any = None, error: RpcError | None = None) -> dict[str, Any]:
    if error is not None:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": error.code, "message": error.message}}
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def create_app(*, token: str | None = None, response_mode: str = "json") -> FastAPI:
    server = DemoServer(token=token, response_mode=response_mode)
    app = FastAPI(title="AgentOS demo MCP server", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.demo = server

    def reply(payload: dict[str, Any], *, headers: dict[str, str] | None = None) -> Response:
        if server.response_mode == "sse":
            body = f"event: message\ndata: {json.dumps(payload)}\n\n"
            return Response(body, media_type="text/event-stream", headers=headers)
        return Response(json.dumps(payload), media_type="application/json", headers=headers)

    def guard(request: Request) -> Response | None:
        origin = request.headers.get("origin")
        if origin and not origin.startswith(LOCAL_ORIGINS):
            return Response(status_code=403)
        if server.token is not None:
            expected = f"Bearer {server.token}"
            if not secrets.compare_digest(request.headers.get("authorization", ""), expected):
                return Response(status_code=401, headers={"WWW-Authenticate": "Bearer"})
        return None

    @app.post("/mcp")
    async def mcp_post(request: Request) -> Response:
        if (denied := guard(request)) is not None:
            return denied
        try:
            message = json.loads(await request.body())
        except (json.JSONDecodeError, UnicodeDecodeError):
            return Response(json.dumps(_rpc_response(None, error=RpcError(-32700, "Parse error"))),
                            status_code=400, media_type="application/json")
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0" or "method" not in message:
            return Response(json.dumps(_rpc_response(None, error=RpcError(-32600, "Invalid Request"))),
                            status_code=400, media_type="application/json")
        method = str(message["method"])
        params = message.get("params") or {}
        if "id" not in message:  # notification (e.g. notifications/initialized)
            return Response(status_code=202)
        request_id = message["id"]
        if method == "initialize":
            result, new_session_id = server.initialize(params if isinstance(params, dict) else {})
            return reply(_rpc_response(request_id, result=result), headers={"Mcp-Session-Id": new_session_id})
        session_id = request.headers.get("mcp-session-id")
        if not session_id:
            return Response(status_code=400)
        if session_id not in server.sessions:
            return Response(status_code=404)
        version = request.headers.get("mcp-protocol-version")
        if version is not None and version not in SUPPORTED_VERSIONS:
            return Response(status_code=400)
        try:
            result = server.dispatch(method, params if isinstance(params, dict) else {})
        except RpcError as exc:
            return reply(_rpc_response(request_id, error=exc))
        return reply(_rpc_response(request_id, result=result))

    @app.get("/mcp")
    async def mcp_get() -> Response:
        return Response(status_code=405, headers={"Allow": "POST, DELETE"})

    @app.delete("/mcp")
    async def mcp_delete(request: Request) -> Response:
        if (denied := guard(request)) is not None:
            return denied
        session_id = request.headers.get("mcp-session-id", "")
        if server.sessions.pop(session_id, None) is None:
            return Response(status_code=404)
        return Response(status_code=200)

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentOS demo MCP server (Streamable HTTP)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=None, help="Require 'Authorization: Bearer <token>'")
    parser.add_argument("--response-mode", choices=("json", "sse"), default="json")
    args = parser.parse_args()
    app = create_app(token=args.token, response_mode=args.response_mode)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
