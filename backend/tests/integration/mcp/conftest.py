"""Fixtures for MCP gateway integration tests: a dedicated FastAPI app (auth + MCP routers)
and a fake MCP server installed as the process-wide connection manager."""

from __future__ import annotations

import asyncio
import socket
import sys
import uuid
from collections.abc import AsyncIterator, Callable
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

_HERE = Path(__file__).resolve().parent
for _path in (str(_HERE.parents[1] / "unit" / "mcp"), str(_HERE)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from mcp_fakes import FakeMCPServer  # noqa: E402
from mcp_gateway_helpers import ApiUser  # noqa: E402

from app.mcp.client import set_mcp_connection_manager  # noqa: E402


@pytest_asyncio.fixture(scope="session")
async def mcp_app() -> FastAPI:
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router
    from app.mcp.router import router as mcp_router

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(mcp_router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def api(mcp_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=mcp_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


@pytest_asyncio.fixture
async def register_user(api: httpx.AsyncClient) -> Any:
    async def _register() -> ApiUser:
        email = f"mcp-{uuid.uuid4().hex[:10]}@example.com"
        resp = await api.post("/api/v1/auth/register", json={
            "email": email, "password": "Str0ng!Passw0rd", "display_name": "MCP Admin", "timezone": "UTC"})
        assert resp.status_code == 201, resp.text
        return ApiUser(resp.json())

    return _register


@pytest_asyncio.fixture
async def fake_mcp() -> AsyncIterator[FakeMCPServer]:
    server = FakeMCPServer()
    manager = server.manager()
    set_mcp_connection_manager(manager)
    yield server
    set_mcp_connection_manager(None)
    if manager.http_client is not None:
        await manager.http_client.aclose()


@pytest_asyncio.fixture
async def patch_dns(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, str]], None]:
    """Make hostnames resolve to chosen addresses (simulates DNS, incl. rebinding between calls)."""
    loop = asyncio.get_running_loop()
    table: dict[str, str] = {}
    original = loop.getaddrinfo

    async def fake_getaddrinfo(host: Any, port: Any, *args: Any, **kwargs: Any) -> Any:
        if isinstance(host, str) and host in table:
            family = socket.AF_INET6 if ":" in table[host] else socket.AF_INET
            return [(family, socket.SOCK_STREAM, 6, "", (table[host], int(port or 0)))]
        return await original(host, port, *args, **kwargs)

    monkeypatch.setattr(loop, "getaddrinfo", fake_getaddrinfo)

    def _set(mapping: dict[str, str]) -> None:
        table.clear()
        table.update(mapping)

    return _set
