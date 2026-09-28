from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from mcp_fakes import ECHO_TOOL, PUBLIC_URL, FakeMCPServer

from app.common.enums import ErrorClass
from app.core.exceptions import (
    IntegrationError,
    IntegrationExpired,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
    ToolError,
    ToolOutputInvalid,
    ToolTimeout,
    UnsafeURL,
)
from app.mcp.client import PROTOCOL_VERSION, MCPConnectionManager, MCPEndpoint, iter_sse_data
from app.mcp.policy import MCPLimits

AUTH = "Bearer top-secret-token-value"


def _endpoint(timeout: float = 5.0, url: str = PUBLIC_URL) -> MCPEndpoint:
    return MCPEndpoint(url=url, timeout_seconds=timeout, auth_headers={"Authorization": AUTH})


@pytest.mark.parametrize("mode", ["json", "sse"])
async def test_handshake_list_and_call(mode: str) -> None:
    fake = FakeMCPServer(mode=mode, expected_auth=AUTH)
    manager = fake.manager()
    snapshot = await manager.discover(_endpoint())
    assert snapshot.protocol_version == PROTOCOL_VERSION
    assert snapshot.server_info["name"] == "fake-mcp"
    assert [t["name"] for t in snapshot.listing.tools] == ["echo", "add_note", "send_message", "always_fails"]
    result = await manager.call_tool(_endpoint(), "echo", {"text": "hello"})
    assert result["structuredContent"] == {"text": "hello", "length": 5}
    assert fake.calls == [("echo", {"text": "hello"})]

    init = fake.bodies("initialize")[0]
    assert init["params"]["protocolVersion"] == "2025-06-18"
    assert init["params"]["clientInfo"]["name"]
    assert len(fake.bodies("notifications/initialized")) == 2
    init_headers = fake.headers_for("initialize")[0]
    assert "mcp-session-id" not in init_headers
    assert "mcp-protocol-version" not in init_headers
    assert "text/event-stream" in init_headers["accept"]
    assert "application/json" in init_headers["accept"]
    for headers in fake.headers_for("tools/list") + fake.headers_for("tools/call"):
        assert headers["mcp-session-id"] == "sess-0001"
        assert headers["mcp-protocol-version"] == "2025-06-18"
        assert headers["authorization"] == AUTH
    assert fake.deleted_sessions == 2  # sessions are closed after use


async def test_requests_are_pinned_to_the_vetted_ip() -> None:
    fake = FakeMCPServer()
    await fake.manager().discover(_endpoint())
    request = fake.requests[0]
    assert request.url.host == "93.184.215.14"
    assert request.headers["host"] == "93.184.215.14"


async def test_pagination_is_followed_and_bounded() -> None:
    tools = [{**ECHO_TOOL, "name": f"tool_{i}"} for i in range(25)]
    fake = FakeMCPServer(tools=tools)
    fake.page_size = 10
    listing = (await fake.manager().discover(_endpoint())).listing
    assert len(listing.tools) == 25
    assert listing.pages == 3
    assert not listing.truncated
    assert [b["params"].get("cursor") for b in fake.bodies("tools/list")] == [None, "10", "20"]

    capped = MCPConnectionManager(http_client=fake.http_client(), limits=MCPLimits(max_tools_per_server=12))
    listing = (await capped.discover(_endpoint())).listing
    assert len(listing.tools) == 12
    assert listing.truncated

    few_pages = MCPConnectionManager(http_client=fake.http_client(), limits=MCPLimits(max_list_pages=2))
    listing = (await few_pages.discover(_endpoint())).listing
    assert len(listing.tools) == 20
    assert listing.truncated


async def test_cursor_loop_is_detected() -> None:
    fake = FakeMCPServer()

    async def looping(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.method == "POST" else {}
        if body.get("method") == "tools/list":
            fake.requests.append(request)
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": body["id"],
                                             "result": {"tools": [ECHO_TOOL], "nextCursor": "same"}})
        return await fake.handle(request)

    manager = MCPConnectionManager(http_client=httpx.AsyncClient(transport=httpx.MockTransport(looping)))
    listing = (await manager.discover(_endpoint())).listing
    assert listing.truncated
    assert listing.pages == 2


async def test_rpc_error_maps_to_tool_error_with_code() -> None:
    fake = FakeMCPServer()
    with pytest.raises(ToolError) as exc:
        await fake.manager().call_tool(_endpoint(), "no_such_tool", {})
    assert exc.value.code == "mcp_rpc_error"
    assert exc.value.details["rpc_code"] == -32602
    assert exc.value.error_class == ErrorClass.INVALID_INPUT

    fake.rpc_errors["tools/list"] = (-32603, "internal boom")
    with pytest.raises(ToolError) as exc:
        await fake.manager().discover(_endpoint())
    assert exc.value.details["rpc_code"] == -32603
    assert exc.value.error_class == ErrorClass.TOOL_UNAVAILABLE


@pytest.mark.parametrize(("status", "error"), [
    (500, IntegrationUnavailable), (503, IntegrationUnavailable), (429, IntegrationRateLimited),
    (401, IntegrationExpired),
])
async def test_http_errors_are_typed(status: int, error: type[Exception]) -> None:
    fake = FakeMCPServer()
    fake.status_override["tools/call"] = status
    with pytest.raises(error) as exc:
        await fake.manager().call_tool(_endpoint(), "echo", {"text": "x"})
    assert "upstream says no" not in str(exc.value.details)  # raw provider bodies never leak


async def test_call_timeout_maps_to_tool_timeout() -> None:
    fake = FakeMCPServer()
    fake.delay["tools/call"] = 2.0
    with pytest.raises(ToolTimeout) as exc:
        await fake.manager().call_tool(_endpoint(timeout=0.2), "echo", {"text": "x"})
    assert exc.value.error_class == ErrorClass.TIMEOUT


async def test_handshake_timeout_maps_to_integration_timeout() -> None:
    fake = FakeMCPServer()
    fake.delay["initialize"] = 2.0
    with pytest.raises(IntegrationTimeout) as exc:
        await fake.manager().discover(_endpoint(timeout=0.2))
    assert exc.value.details["phase"] == "initialize"


async def test_unsupported_protocol_version_rejected() -> None:
    fake = FakeMCPServer(protocol_version="1999-01-01")
    with pytest.raises(IntegrationError, match="unsupported protocol"):
        await fake.manager().discover(_endpoint())


async def test_oversized_response_rejected() -> None:
    fake = FakeMCPServer()
    fake.call_handler = lambda name, args: {"content": [{"type": "text", "text": "x" * 5000}]}
    small = MCPConnectionManager(http_client=fake.http_client(), limits=MCPLimits(max_response_bytes=1024))
    with pytest.raises(ToolOutputInvalid, match="size"):
        await small.call_tool(_endpoint(), "echo", {"text": "x"})


async def test_redirects_are_refused() -> None:
    async def redirect(request: httpx.Request) -> httpx.Response:
        return httpx.Response(307, headers={"location": "https://1.1.1.1/steal"})

    manager = MCPConnectionManager(http_client=httpx.AsyncClient(transport=httpx.MockTransport(redirect)))
    with pytest.raises(UnsafeURL):
        await manager.discover(_endpoint())


@pytest.mark.parametrize("body", [b"not json", b"{\"jsonrpc\": \"2.0\", \"id\": 999, \"result\": {}}", b"[]"])
async def test_malformed_responses(body: bytes) -> None:
    fake = FakeMCPServer()

    async def broken(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content) if request.method == "POST" else {}
        if payload.get("method") == "tools/call":
            return httpx.Response(200, content=body, headers={"content-type": "application/json"})
        return await fake.handle(request)

    manager = MCPConnectionManager(http_client=httpx.AsyncClient(transport=httpx.MockTransport(broken)))
    with pytest.raises(ToolOutputInvalid):
        await manager.call_tool(_endpoint(), "echo", {"text": "x"})


async def test_unsafe_url_refused_before_any_request() -> None:
    fake = FakeMCPServer()
    with pytest.raises(UnsafeURL):
        await fake.manager().discover(_endpoint(url="http://169.254.169.254/latest"))
    assert fake.requests == []


def test_sse_parser_handles_multiline_crlf_comments_and_unicode_separators() -> None:
    message: dict[str, Any] = {"jsonrpc": "2.0", "id": 1, "result": {"text": "a\u2028b"}}
    raw = json.dumps(message, ensure_ascii=False)
    stream = (": comment\r\n\r\n"
              "event: message\r\ndata: {\"jsonrpc\": \"2.0\",\r\ndata:  \"method\": \"x\"}\r\n\r\n"
              f"data:{raw}\n\n"
              "data: trailing")
    events = list(iter_sse_data(stream))
    assert events[0] == "{\"jsonrpc\": \"2.0\",\n \"method\": \"x\"}"
    assert json.loads(events[1]) == message
    assert events[2] == "trailing"


def test_endpoint_repr_hides_auth_headers() -> None:
    assert "top-secret" not in repr(_endpoint())
