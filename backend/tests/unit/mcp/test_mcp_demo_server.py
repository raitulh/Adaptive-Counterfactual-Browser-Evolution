"""The standalone demo MCP server (scripts/demo_mcp_server.py) against the real gateway client."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import httpx
import pytest
from mcp_fakes import PUBLIC_URL, binding_for, tool_context

from app.common.enums import PermissionLevel, RiskLevel, VerificationStatus
from app.core.exceptions import IntegrationExpired, ToolError
from app.mcp.adapter import MCPToolAdapter, normalize_call_result
from app.mcp.client import MCPConnectionManager, MCPEndpoint
from app.mcp.policy import normalize_remote_tool
from app.tools.base import ToolResult


def _load_demo() -> ModuleType:
    path = Path(__file__).resolve().parents[3] / "scripts" / "demo_mcp_server.py"
    spec = importlib.util.spec_from_file_location("agentos_demo_mcp_server", path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


demo = _load_demo()


def _manager(app: Any) -> MCPConnectionManager:
    return MCPConnectionManager(http_client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app)))


def _endpoint(token: str | None = "demo-token") -> MCPEndpoint:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    return MCPEndpoint(url=PUBLIC_URL, timeout_seconds=5, auth_headers=headers)


@pytest.mark.parametrize("mode", ["json", "sse"])
async def test_demo_server_round_trip(mode: str) -> None:
    app = demo.create_app(token="demo-token", response_mode=mode)
    manager = _manager(app)
    snapshot = await manager.discover(_endpoint())
    assert snapshot.protocol_version == "2025-06-18"
    assert snapshot.server_info["name"] == "agentos-demo-mcp"
    normalized = {t["name"]: normalize_remote_tool(t, "demo") for t in snapshot.listing.tools}
    assert set(normalized) == {"echo", "add_note"}
    assert normalized["echo"].annotations["readOnlyHint"] is True
    assert normalized["add_note"].output_schema is not None

    echo = await manager.call_tool(_endpoint(), "echo", {"text": "hi"})
    assert echo["structuredContent"] == {"text": "hi", "length": 2}
    with pytest.raises(ToolError) as exc:
        await manager.call_tool(_endpoint(), "nope", {})
    assert exc.value.details["rpc_code"] == -32602
    assert app.state.demo.sessions == {}  # every session was closed with DELETE


async def test_demo_add_note_is_verifiable() -> None:
    app = demo.create_app(token="demo-token")
    manager = _manager(app)
    raw_tool = next(t for t in demo.TOOLS if t["name"] == "add_note")
    binding = binding_for(raw_tool, permission_level=PermissionLevel.WRITE, risk_level=RiskLevel.MEDIUM)
    adapter = MCPToolAdapter(binding, connection_manager=manager)
    args = adapter.parse_args({"title": "Groceries", "body": "milk"})
    raw = await manager.call_tool(_endpoint(), "add_note", args.root)
    output = normalize_call_result(raw, binding)
    result = ToolResult(output=output.model_dump(), summary="saved")
    outcome = await adapter.verify(tool_context(binding.tenant_id), args, result)
    assert outcome.status is VerificationStatus.PASSED
    assert len(app.state.demo.notes) == 1


async def test_demo_server_requires_token_and_session() -> None:
    app = demo.create_app(token="demo-token")
    with pytest.raises(IntegrationExpired):
        await _manager(app).discover(_endpoint(token="wrong"))
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
        no_session = await client.post("/mcp", headers={"Authorization": "Bearer demo-token"},
                                       json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert no_session.status_code == 400
        cross_origin = await client.post("/mcp", headers={"Authorization": "Bearer demo-token",
                                                          "Origin": "https://evil.example"},
                                         json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert cross_origin.status_code == 403
