"""Helpers shared by the MCP gateway integration tests (API round trips, resolution, audit reads)."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
from mcp_fakes import PUBLIC_URL
from sqlalchemy import select

from app.audit.models import AuditLog
from app.common.context import RequestContext
from app.core.database import system_session, tenant_session
from app.mcp.service import list_mcp_tools_for_tenant, resolve_mcp_tool
from app.organizations.rbac import ROLE_PERMISSIONS
from app.tools.base import Tool

API = "/api/v1/mcp"


class ApiUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def ctx(self, permissions: frozenset[str] | None = None) -> RequestContext:
        """Service-level context equivalent to what ``get_ctx`` builds for this (owner) user."""
        perms = permissions if permissions is not None else frozenset(ROLE_PERMISSIONS["owner"])
        return RequestContext(user_id=self.user_id, tenant_id=self.tenant_id, role="owner", permissions=perms)


async def create_server(api: httpx.AsyncClient, user: ApiUser, *, name: str = "demo", url: str = PUBLIC_URL,
                        expect: int = 201, **extra: Any) -> dict[str, Any]:
    resp = await api.post(f"{API}/servers", headers=user.headers, json={"name": name, "url": url, **extra})
    assert resp.status_code == expect, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def approve(api: httpx.AsyncClient, user: ApiUser, server_id: str) -> dict[str, Any]:
    resp = await api.post(f"{API}/servers/{server_id}/approve", headers=user.headers)
    assert resp.status_code == 200, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def sync(api: httpx.AsyncClient, user: ApiUser, server_id: str) -> dict[str, Any]:
    resp = await api.post(f"{API}/servers/{server_id}/sync", headers=user.headers)
    assert resp.status_code == 200, resp.text
    data: dict[str, Any] = resp.json()
    return data


def tools_by_remote_name(sync_result: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {tool["remote_name"]: tool for tool in sync_result["tools"]}


async def patch_tool(api: httpx.AsyncClient, user: ApiUser, tool_id: str, expect: int = 200,
                     **fields: Any) -> dict[str, Any]:
    resp = await api.patch(f"{API}/tools/{tool_id}", headers=user.headers, json=fields)
    assert resp.status_code == expect, resp.text
    data: dict[str, Any] = resp.json()
    return data


async def ready_server(api: httpx.AsyncClient, user: ApiUser, *, name: str = "demo",
                       **extra: Any) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Register → approve → sync. Returns the server and its tools keyed by remote name."""
    server = await create_server(api, user, name=name, **extra)
    await approve(api, user, server["id"])
    result = await sync(api, user, server["id"])
    return result["server"], tools_by_remote_name(result)


async def resolve(tenant_id: uuid.UUID, name: str) -> Tool[Any, Any] | None:
    async with tenant_session(tenant_id) as session:
        return await resolve_mcp_tool(session, tenant_id, name)


async def resolve_on_system_session(tenant_id: uuid.UUID, name: str) -> Tool[Any, Any] | None:
    async with system_session() as session:
        return await resolve_mcp_tool(session, tenant_id, name)


async def available_names(tenant_id: uuid.UUID) -> list[str]:
    async with tenant_session(tenant_id) as session:
        return [tool.name for tool in await list_mcp_tools_for_tenant(session, tenant_id)]


async def audit_rows(tenant_id: uuid.UUID, action_prefix: str = "mcp.") -> list[AuditLog]:
    async with system_session() as session:
        rows = await session.execute(select(AuditLog).where(AuditLog.tenant_id == tenant_id,
                                                            AuditLog.action.startswith(action_prefix))
                                     .order_by(AuditLog.created_at))
        return list(rows.scalars().all())
