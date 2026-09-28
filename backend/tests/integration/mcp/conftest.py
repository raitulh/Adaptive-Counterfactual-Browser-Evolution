"""Fixtures for MCP gateway integration tests: a dedicated FastAPI app (auth + MCP routers)
and a fake MCP server installed as the process-wide connection manager."""

from __future__ import annotations

import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import pytest_asyncio
from fastapi import FastAPI

_FAKES = str(Path(__file__).resolve().parents[2] / "unit" / "mcp")
if _FAKES not in sys.path:
    sys.path.insert(0, _FAKES)

from mcp_fakes import FakeMCPServer  # noqa: E402

from app.mcp.client import set_mcp_connection_manager  # noqa: E402


class ApiUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}


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
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mcp_app), base_url="http://testserver") as c:
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
    set_mcp_connection_manager(server.manager())
    yield server
    set_mcp_connection_manager(None)
