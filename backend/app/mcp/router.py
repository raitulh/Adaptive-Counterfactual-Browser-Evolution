"""MCP gateway API: register, review, sync and govern tenant MCP servers and their tools.

Credentials are write-only (never returned). Listing requires ``tools:read``; every
change requires ``mcp:manage`` and is audited by the service layer.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies import DbSession, IdempotencyKeyHeader, require
from app.common.context import RequestContext
from app.common.idempotency import run_idempotent
from app.mcp import service
from app.mcp.schemas import MCPServerCreate, MCPServerOut, MCPSyncResult, MCPToolOut, MCPToolUpdate
from app.organizations.rbac import P

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _fingerprint_payload(body: MCPServerCreate) -> dict[str, Any]:
    payload = body.model_dump(mode="json", exclude={"auth_header_value"})
    if body.auth_header_value is not None:
        secret = body.auth_header_value.get_secret_value().encode("utf-8")
        payload["auth_header_value_sha256"] = hashlib.sha256(secret).hexdigest()
    return payload


@router.post("/servers", response_model=MCPServerOut, status_code=status.HTTP_201_CREATED,
             summary="Register an MCP server (pending admin review)",
             responses={409: {"description": "Name already used"}, 422: {"description": "URL not allowed"}})
async def register_server(body: MCPServerCreate, response: Response, db: DbSession,
                          idempotency_key: IdempotencyKeyHeader = None,
                          ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> Any:
    async def handler() -> tuple[int, MCPServerOut]:
        server = await service.register_server(db, ctx, body)
        return status.HTTP_201_CREATED, service.server_out(server)

    result = await run_idempotent(ctx, idempotency_key, "POST", "/mcp/servers", _fingerprint_payload(body),
                                  handler)
    if result.replayed:
        response.headers["Idempotent-Replayed"] = "true"
    response.status_code = result.status_code
    return result.body


@router.get("/servers", response_model=list[MCPServerOut], summary="List the organization's MCP servers")
async def list_servers(db: DbSession,
                       ctx: RequestContext = Depends(require(P.TOOLS_READ))) -> list[MCPServerOut]:
    return [service.server_out(s) for s in await service.list_servers(db, ctx)]


@router.get("/servers/{server_id}", response_model=MCPServerOut, summary="Get one MCP server")
async def get_server(server_id: uuid.UUID, db: DbSession,
                     ctx: RequestContext = Depends(require(P.TOOLS_READ))) -> MCPServerOut:
    return service.server_out(await service.get_server(db, ctx, server_id))


@router.post("/servers/{server_id}/approve", response_model=MCPServerOut,
             summary="Approve an MCP server after review (re-vets its URL)")
async def approve_server(server_id: uuid.UUID, db: DbSession,
                         ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> MCPServerOut:
    return service.server_out(await service.approve_server(db, ctx, server_id))


@router.post("/servers/{server_id}/disable", response_model=MCPServerOut,
             summary="Disable an MCP server (all of its tools become unavailable)")
async def disable_server(server_id: uuid.UUID, db: DbSession,
                         ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> MCPServerOut:
    return service.server_out(await service.disable_server(db, ctx, server_id))


@router.delete("/servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None,
               response_class=Response, summary="Delete an MCP server and its tools")
async def delete_server(server_id: uuid.UUID, db: DbSession,
                        ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> Response:
    await service.delete_server(db, ctx, server_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/servers/{server_id}/sync", response_model=MCPSyncResult,
             summary="Discover the server's tools; changed tools are disabled until re-approved")
async def sync_server(server_id: uuid.UUID, db: DbSession,
                      ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> MCPSyncResult:
    return await service.sync_tools(db, ctx, server_id)


@router.get("/servers/{server_id}/tools", response_model=list[MCPToolOut],
            summary="List the tools discovered on an MCP server")
async def list_server_tools(server_id: uuid.UUID, db: DbSession,
                            ctx: RequestContext = Depends(require(P.TOOLS_READ))) -> list[MCPToolOut]:
    server, tools = await service.list_tools(db, ctx, server_id)
    return [service.tool_out(t, server) for t in tools]


@router.patch("/tools/{tool_id}", response_model=MCPToolOut,
              summary="Enable/disable an MCP tool or set its permission level, risk and approval requirement")
async def update_tool(tool_id: uuid.UUID, body: MCPToolUpdate, db: DbSession,
                      ctx: RequestContext = Depends(require(P.MCP_MANAGE))) -> MCPToolOut:
    tool, server = await service.update_tool(db, ctx, tool_id, body)
    return service.tool_out(tool, server)
