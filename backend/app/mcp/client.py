"""MCPConnectionManager: JSON-RPC 2.0 over the MCP Streamable HTTP transport.

Every request goes through ``app.security.http.safe_request`` (SSRF-vetted, IP-pinned,
size-capped, no redirects — a redirect could forward the tenant's credential to another
host). Each request also has a hard deadline (``asyncio.timeout``) so a server that
trickles bytes cannot hold a worker. Responses may be ``application/json`` or a
``text/event-stream``; for the latter the SSE ``data:`` payloads are parsed and the
JSON-RPC response with the matching id is selected (server-to-client requests and
notifications on the stream are ignored: the gateway offers no client capabilities).

Error mapping:
* timeout -> ``IntegrationTimeout`` (handshake/listing) or ``ToolTimeout`` (tools/call);
* JSON-RPC error object -> ``ToolError`` (code ``mcp_rpc_error``, ``details.rpc_code``);
* HTTP 5xx -> ``IntegrationUnavailable``; 429 -> ``IntegrationRateLimited``;
  401 -> ``IntegrationExpired``; 403 -> ``InsufficientScope``; 404 -> ``IntegrationNotFound``;
  other 4xx -> ``IntegrationBadRequest``;
* malformed/oversized responses -> ``IntegrationError`` (``ToolOutputInvalid`` for tools/call,
  whose outcome is then unknown).

Auth headers are never logged: ``MCPEndpoint`` keeps them out of its repr, and log
records carry only the server host and the JSON-RPC method.
"""

from __future__ import annotations

import asyncio
import contextlib
import itertools
import json
import logging
import re
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

import httpx

from app.common.enums import ErrorClass
from app.common.sanitize import bound_structure, clean_text
from app.core.config import get_settings
from app.core.exceptions import (
    AppError,
    InsufficientScope,
    IntegrationBadRequest,
    IntegrationError,
    IntegrationExpired,
    IntegrationNotFound,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
    PayloadTooLarge,
    ToolError,
    ToolOutputInvalid,
    ToolTimeout,
)
from app.mcp.policy import DEFAULT_LIMITS, MCPLimits, MCPPolicyChecker
from app.security.http import SafeResponse, safe_request
from app.security.ssrf import EgressPolicy

logger = logging.getLogger(__name__)

PROTOCOL_VERSION = "2025-06-18"
SUPPORTED_PROTOCOL_VERSIONS = frozenset({"2025-06-18", "2025-03-26"})
PROVIDER = "mcp"
_SESSION_ID_RE = re.compile(r"^[\x21-\x7e]{1,256}$")
_SSE_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_MAX_SSE_EVENTS = 1_000
_HANDSHAKE_TIMEOUT_CAP = 15.0
_CLOSE_TIMEOUT = 3.0

# JSON-RPC error codes that mean "the arguments/request were wrong" rather than "server broken".
_INVALID_INPUT_RPC_CODES = frozenset({-32602, -32600, -32700})


@dataclass(frozen=True, slots=True)
class MCPEndpoint:
    url: str
    timeout_seconds: float
    auth_headers: dict[str, str] = field(default_factory=dict, repr=False)
    label: str = "mcp"

    @property
    def host(self) -> str:
        return (urlsplit(self.url).hostname or "").lower()


@dataclass(frozen=True, slots=True)
class ToolListing:
    tools: list[Any]
    truncated: bool
    pages: int


@dataclass(frozen=True, slots=True)
class ServerSnapshot:
    """What a sync learned about a server: negotiated protocol, server info and its tool list."""

    protocol_version: str
    server_info: dict[str, Any]
    instructions: str | None
    listing: ToolListing


@dataclass(slots=True)
class MCPConnection:
    """One initialized MCP session. Created by ``MCPConnectionManager.connect``."""

    manager: MCPConnectionManager
    endpoint: MCPEndpoint
    session_id: str | None = None
    protocol_version: str = PROTOCOL_VERSION
    server_info: dict[str, Any] = field(default_factory=dict)
    capabilities: dict[str, Any] = field(default_factory=dict)
    instructions: str | None = None
    initialized: bool = False
    _ids: Iterator[int] = field(default_factory=lambda: itertools.count(1))

    # ------------------------------------------------------------------ lifecycle
    async def initialize(self) -> None:
        result = await self.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "AgentOS MCP Gateway", "version": get_settings().app_version},
        }, phase="initialize")
        version = result.get("protocolVersion")
        if not isinstance(version, str) or version not in SUPPORTED_PROTOCOL_VERSIONS:
            raise IntegrationError("The MCP server uses an unsupported protocol version", provider=PROVIDER,
                                   error_class=ErrorClass.TOOL_UNAVAILABLE,
                                   details={"protocol_version": clean_text(str(version), max_chars=40)})
        self.protocol_version = version
        caps = result.get("capabilities")
        self.capabilities = caps if isinstance(caps, dict) else {}
        info = result.get("serverInfo")
        self.server_info = bound_structure(info, max_depth=3, max_items=10, max_string=200) \
            if isinstance(info, dict) else {}
        instructions = result.get("instructions")
        self.instructions = (clean_text(instructions, max_chars=2_000)
                             if isinstance(instructions, str) else None)
        self.initialized = True
        await self.notify("notifications/initialized")

    async def close(self) -> None:
        """Best-effort session termination (HTTP DELETE with the session id)."""
        if not self.session_id:
            return
        try:
            async with asyncio.timeout(_CLOSE_TIMEOUT):
                await safe_request("DELETE", self.endpoint.url, policy=self.manager.egress_policy(),
                                   headers=self._headers(), timeout=_CLOSE_TIMEOUT, max_bytes=64 * 1024,
                                   max_redirects=0, client=self.manager.http_client)
        except (AppError, TimeoutError, httpx.HTTPError):
            logger.debug("mcp session close failed", extra={"mcp_host": self.endpoint.host})

    # ------------------------------------------------------------------ operations
    async def list_tools(self) -> ToolListing:
        if "tools" not in self.capabilities:
            raise IntegrationError("The MCP server does not offer tools", provider=PROVIDER,
                                   error_class=ErrorClass.TOOL_UNAVAILABLE)
        limits = self.manager.limits
        tools: list[Any] = []
        cursor: str | None = None
        seen_cursors: set[str] = set()
        pages = 0
        truncated = False
        while True:
            pages += 1
            result = await self.request("tools/list", {"cursor": cursor} if cursor else {}, phase="list")
            page = result.get("tools")
            if not isinstance(page, list):
                raise IntegrationError("The MCP server returned a malformed tool list", provider=PROVIDER,
                                       error_class=ErrorClass.TOOL_UNAVAILABLE)
            for item in page:
                if len(tools) >= limits.max_tools_per_server:
                    truncated = True
                    break
                tools.append(item)
            next_cursor = result.get("nextCursor")
            if truncated or not isinstance(next_cursor, str) or not next_cursor:
                break
            if len(next_cursor) > 1024 or next_cursor in seen_cursors or pages >= limits.max_list_pages:
                truncated = True
                break
            seen_cursors.add(next_cursor)
            cursor = next_cursor
        return ToolListing(tools=tools, truncated=truncated, pages=pages)

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        return await self.request("tools/call", {"name": name, "arguments": arguments}, phase="call")

    # ------------------------------------------------------------------ transport
    def _headers(self) -> dict[str, str]:
        headers = {
            **self.endpoint.auth_headers,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        if self.initialized:
            headers["MCP-Protocol-Version"] = self.protocol_version
        return headers

    def _timeout_for(self, phase: str) -> float:
        timeout = self.endpoint.timeout_seconds
        return timeout if phase == "call" else min(timeout, _HANDSHAKE_TIMEOUT_CAP)

    async def _post(self, payload: dict[str, Any], *, phase: str) -> SafeResponse:
        timeout = self._timeout_for(phase)
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        try:
            async with asyncio.timeout(timeout):
                return await safe_request("POST", self.endpoint.url, policy=self.manager.egress_policy(),
                                          headers=self._headers(), content=body, timeout=timeout,
                                          max_bytes=self.manager.limits.max_response_bytes, max_redirects=0,
                                          client=self.manager.http_client)
        except (TimeoutError, IntegrationTimeout) as exc:
            logger.info("mcp request timed out", extra={"mcp_host": self.endpoint.host, "phase": phase})
            if phase == "call":
                raise ToolTimeout("The MCP tool did not respond in time",
                                  details={"timeout_seconds": timeout}) from exc
            raise IntegrationTimeout("The MCP server did not respond in time", provider=PROVIDER,
                                     details={"phase": phase}) from exc
        except PayloadTooLarge as exc:
            raise self._malformed(phase, "The MCP server response exceeds the allowed size") from exc

    @staticmethod
    def _malformed(phase: str, message: str) -> AppError:
        if phase == "call":
            return ToolOutputInvalid(message)
        return IntegrationError(message, provider=PROVIDER, error_class=ErrorClass.TOOL_UNAVAILABLE)

    async def notify(self, method: str, params: dict[str, Any] | None = None) -> None:
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if params:
            payload["params"] = params
        response = await self._post(payload, phase="notify")
        if not 200 <= response.status_code < 300:
            raise _http_error(response.status_code)

    async def request(self, method: str, params: dict[str, Any], *, phase: str) -> dict[str, Any]:
        request_id = next(self._ids)
        response = await self._post({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params},
                                    phase=phase)
        if response.status_code != 200:
            raise _http_error(response.status_code)
        if method == "initialize":
            self._capture_session(response)
        message = self._extract_response(response, request_id, phase)
        if "error" in message:
            raise _rpc_error(message["error"], phase)
        result = message.get("result")
        if not isinstance(result, dict):
            raise self._malformed(phase, "The MCP server returned a malformed result")
        return result

    def _capture_session(self, response: SafeResponse) -> None:
        session_id = response.headers.get("mcp-session-id")
        if session_id is None:
            return
        if not _SESSION_ID_RE.match(session_id):
            raise IntegrationError("The MCP server returned an invalid session id", provider=PROVIDER,
                                   error_class=ErrorClass.TOOL_UNAVAILABLE)
        self.session_id = session_id

    def _extract_response(self, response: SafeResponse, request_id: int, phase: str) -> dict[str, Any]:
        ctype = response.headers.get("content-type", "").split(";")[0].strip().lower()
        try:
            if ctype == "text/event-stream":
                candidates = [msg for data in iter_sse_data(response.text)
                              for msg in _messages(json.loads(data))]
            elif ctype == "application/json" or ctype.endswith("+json"):
                candidates = _messages(json.loads(response.content))
            else:
                raise self._malformed(phase, "The MCP server returned an unsupported content type")
        except (json.JSONDecodeError, UnicodeDecodeError, RecursionError) as exc:
            raise self._malformed(phase, "The MCP server returned malformed JSON") from exc
        for message in candidates:
            if (isinstance(message, dict) and message.get("jsonrpc") == "2.0"
                    and message.get("id") == request_id and ("result" in message or "error" in message)):
                return message
        raise self._malformed(phase, "The MCP server did not answer the request")


def _messages(parsed: Any) -> list[Any]:
    return list(parsed) if isinstance(parsed, list) else [parsed]


def iter_sse_data(text: str) -> Iterator[str]:
    """Yield the ``data`` payload of each server-sent event (multi-line data joined by ``\\n``)."""
    data_lines: list[str] = []
    events = 0
    for line in _SSE_LINE_BREAK.split(text):
        if line == "":
            if data_lines:
                events += 1
                yield "\n".join(data_lines)
                data_lines = []
                if events >= _MAX_SSE_EVENTS:
                    return
            continue
        if line.startswith(":"):
            continue
        name, _, value = line.partition(":")
        if name == "data":
            data_lines.append(value[1:] if value.startswith(" ") else value)
    if data_lines:
        yield "\n".join(data_lines)


def _http_error(status: int) -> AppError:
    kwargs: dict[str, Any] = {"provider": PROVIDER, "status": status}
    if status >= 500:
        return IntegrationUnavailable("The MCP server is temporarily unavailable", **kwargs)
    if status == 429:
        return IntegrationRateLimited("The MCP server is rate limiting requests", **kwargs)
    if status == 401:
        return IntegrationExpired("The MCP server rejected the configured credentials", **kwargs)
    if status == 403:
        return InsufficientScope("The MCP server denied access", **kwargs)
    if status == 404:
        return IntegrationNotFound("The MCP endpoint or session was not found", **kwargs)
    return IntegrationBadRequest("The MCP server rejected the request", details={"status": status}, **kwargs)


def _rpc_error(error: Any, phase: str) -> ToolError:
    code = error.get("code") if isinstance(error, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    rpc_code = code if isinstance(code, int) and not isinstance(code, bool) else None
    error_class = (ErrorClass.INVALID_INPUT if rpc_code in _INVALID_INPUT_RPC_CODES
                   else ErrorClass.TOOL_UNAVAILABLE)
    rpc_message = clean_text(message, max_chars=300) if isinstance(message, str) else None
    return ToolError("The MCP server returned an error", code="mcp_rpc_error", error_class=error_class,
                     details={"rpc_code": rpc_code, "phase": phase, "rpc_message": rpc_message})


class MCPConnectionManager:
    """Opens initialized MCP sessions. Inject ``http_client`` (e.g. an ``httpx.MockTransport``) in tests."""

    def __init__(self, *, http_client: httpx.AsyncClient | None = None, limits: MCPLimits = DEFAULT_LIMITS,
                 policy_checker: MCPPolicyChecker | None = None) -> None:
        self.http_client = http_client
        self.limits = limits
        self._policy_checker = policy_checker or MCPPolicyChecker(limits=limits)

    def egress_policy(self) -> EgressPolicy:
        return self._policy_checker.egress_policy()

    @contextlib.asynccontextmanager
    async def connect(self, endpoint: MCPEndpoint) -> AsyncIterator[MCPConnection]:
        self._policy_checker.check_url_syntax(endpoint.url)
        connection = MCPConnection(manager=self, endpoint=endpoint)
        try:
            await connection.initialize()
            yield connection
        finally:
            await connection.close()

    async def discover(self, endpoint: MCPEndpoint) -> ServerSnapshot:
        async with self.connect(endpoint) as connection:
            listing = await connection.list_tools()
            return ServerSnapshot(protocol_version=connection.protocol_version,
                                  server_info=connection.server_info, instructions=connection.instructions,
                                  listing=listing)

    async def call_tool(self, endpoint: MCPEndpoint, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        async with self.connect(endpoint) as connection:
            return await connection.call_tool(name, arguments)


_manager: MCPConnectionManager | None = None


def get_mcp_connection_manager() -> MCPConnectionManager:
    global _manager
    if _manager is None:
        _manager = MCPConnectionManager()
    return _manager


def set_mcp_connection_manager(manager: MCPConnectionManager | None) -> None:
    global _manager
    _manager = manager
