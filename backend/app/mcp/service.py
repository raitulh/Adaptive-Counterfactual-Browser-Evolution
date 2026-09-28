"""MCP gateway service.

* **MCPServerRegistry** — ``register_server`` / ``approve_server`` / ``disable_server`` /
  ``delete_server`` / ``list_servers`` / ``get_server``: tenant servers, SSRF-vetted URLs,
  encrypted auth, admin review.
* **MCPToolRegistry** — ``sync_tools`` / ``list_tools`` / ``update_tool``: discovery,
  schema validation, rug-pull protection (a changed schema/description disables the tool
  until re-approved), admin-assigned permission/risk levels.
* **Resolution** — ``resolve_mcp_tool`` / ``list_mcp_tools_for_tenant`` (used by
  ``app.tools.registry.ToolResolver``) and ``load_call_endpoint`` (used by the adapter
  right before each call). Every query filters on ``tenant_id`` explicitly, so isolation
  holds even on system-scoped worker sessions.

Network I/O (DNS vetting, MCP calls) never runs inside a DB transaction: the pattern is
read → commit → call → write → commit.
"""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.enums import ErrorClass, PermissionLevel, RiskLevel
from app.common.feature_flags import Flags, is_enabled, require_enabled
from app.common.redaction import REDACTED, is_sensitive_key
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.crypto import DecryptionError, get_key_manager
from app.core.exceptions import (
    AppError,
    Conflict,
    FeatureDisabled,
    IntegrationNotConnected,
    InvalidStateTransition,
    NotFound,
    PolicyDenied,
    UnsafeURL,
    ValidationFailed,
)
from app.mcp.adapter import MCPToolAdapter, MCPToolBinding
from app.mcp.client import MCPEndpoint, ServerSnapshot, get_mcp_connection_manager
from app.mcp.models import MCPServer, MCPServerStatus, MCPTool, MCPToolStatus, MCPTransport
from app.mcp.policy import MCPPolicyChecker, MCPToolRejected, NormalizedTool, normalize_remote_tool
from app.mcp.schemas import (
    QUALIFIED_NAME_PATTERN,
    MCPServerCreate,
    MCPServerOut,
    MCPSyncResult,
    MCPToolOut,
    MCPToolUpdate,
    RejectedTool,
)
from app.organizations.rbac import P
from app.security.ratelimit import get_rate_limiter
from app.tools.base import Tool
from app.tools.models import ToolCredential

logger = logging.getLogger(__name__)

_QUALIFIED_RE = re.compile(QUALIFIED_NAME_PATTERN)
_TRANSIENT_CLASSES = frozenset({ErrorClass.TRANSIENT, ErrorClass.TIMEOUT, ErrorClass.RATE_LIMITED,
                                ErrorClass.NETWORK_ERROR})
_MAX_TENANT_TOOLS = 1_000


def _policy() -> MCPPolicyChecker:
    return MCPPolicyChecker()


# ---------------------------------------------------------------------------- helpers
async def _require_mcp_enabled(session: AsyncSession, tenant_id: uuid.UUID) -> None:
    if not get_settings().mcp_enabled:
        raise FeatureDisabled(details={"flag": Flags.MCP})
    await require_enabled(session, Flags.MCP, tenant_id)


async def _end_transaction(session: AsyncSession) -> None:
    """Close the current (read) transaction before network I/O."""
    if session.in_transaction():
        await session.commit()


async def _get_server(session: AsyncSession, tenant_id: uuid.UUID, server_id: uuid.UUID, *,
                      for_update: bool = False) -> MCPServer:
    stmt = select(MCPServer).where(MCPServer.id == server_id, MCPServer.tenant_id == tenant_id)
    if for_update:
        stmt = stmt.with_for_update()
    server = (await session.execute(stmt)).scalar_one_or_none()
    if server is None:
        raise NotFound("MCP server not found")
    return server


async def _get_tool_with_server(session: AsyncSession, tenant_id: uuid.UUID, tool_id: uuid.UUID
                                ) -> tuple[MCPTool, MCPServer] | None:
    row = (await session.execute(
        select(MCPTool, MCPServer).join(MCPServer, MCPServer.id == MCPTool.server_id)
        .where(MCPTool.id == tool_id, MCPTool.tenant_id == tenant_id, MCPServer.tenant_id == tenant_id)
    )).one_or_none()
    return (row[0], row[1]) if row is not None else None


def _safe_error(exc: AppError) -> str:
    return f"{exc.code}: {exc.message}"[:500]


async def _commit_and_refresh(session: AsyncSession, *objects: Any) -> None:
    """Commit, then reload the rows so responses carry the server-generated ``updated_at``
    (never lazy-loaded later from async code)."""
    await session.commit()
    for obj in objects:
        await session.refresh(obj)


def display_url(url: str) -> str:
    """The server URL with the values of credential-looking query parameters masked."""
    parts = urlsplit(url)
    if not parts.query:
        return url
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    if not any(is_sensitive_key(key) for key, _ in pairs):
        return url
    masked = [(key, REDACTED if is_sensitive_key(key) else value) for key, value in pairs]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(masked, safe="[]"), parts.fragment))


def server_out(server: MCPServer) -> MCPServerOut:
    has_auth = bool(server.auth_header_enc) or server.auth_credential_id is not None
    return MCPServerOut(
        id=server.id, name=server.name, url=display_url(server.url), transport=server.transport,
        status=server.status,
        has_auth=has_auth, auth_header_name=server.auth_header_name if has_auth else None,
        auth_credential_id=server.auth_credential_id, created_by=server.created_by,
        approved_by=server.approved_by, approved_at=server.approved_at,
        timeout_seconds=server.timeout_seconds,
        rate_limit_per_minute=server.rate_limit_per_minute, protocol_version=server.protocol_version,
        server_info=server.server_info or {}, last_sync_at=server.last_sync_at, last_error=server.last_error,
        created_at=server.created_at, updated_at=server.updated_at,
    )


def tool_out(tool: MCPTool, server: MCPServer) -> MCPToolOut:
    return MCPToolOut(
        id=tool.id, server_id=tool.server_id, remote_name=tool.remote_name,
        qualified_name=tool.qualified_name,
        title=tool.title, description=tool.description, input_schema=tool.input_schema,
        output_schema=tool.output_schema, annotations=tool.annotations or {}, schema_hash=tool.schema_hash,
        approved_schema_hash=tool.approved_schema_hash,
        schema_approved=(tool.approved_schema_hash is not None
                         and tool.approved_schema_hash == tool.schema_hash),
        permission_level=PermissionLevel(tool.permission_level), risk_level=RiskLevel(tool.risk_level),
        requires_approval=tool.requires_approval, enabled=tool.enabled, status=tool.status,
        usable=_policy().is_tool_usable(tool, server, tool.tenant_id), approved_by=tool.approved_by,
        approved_at=tool.approved_at, last_seen_at=tool.last_seen_at, created_at=tool.created_at,
        updated_at=tool.updated_at,
    )


async def endpoint_for(session: AsyncSession, server: MCPServer) -> MCPEndpoint:
    """Build the call target, decrypting the auth header. The result must never be logged."""
    secret: str | None = None
    try:
        if server.auth_header_enc:
            secret = get_key_manager().decrypt(server.auth_header_enc)
        elif server.auth_credential_id is not None:
            credential = (await session.execute(select(ToolCredential).where(
                ToolCredential.id == server.auth_credential_id, ToolCredential.tenant_id == server.tenant_id)
            )).scalar_one_or_none()
            if credential is None:
                raise IntegrationNotConnected("The MCP server's credential no longer exists", provider="mcp")
            secret = get_key_manager().decrypt(credential.secret_encrypted)
    except DecryptionError as exc:
        raise IntegrationNotConnected("The stored MCP credential cannot be used; please re-enter it",
                                      provider="mcp") from exc
    headers = {server.auth_header_name: secret} if secret is not None else {}
    timeout = min(float(server.timeout_seconds), 120.0)
    return MCPEndpoint(url=server.url, timeout_seconds=timeout, auth_headers=headers, label=server.name)


# ---------------------------------------------------------------------------- MCPServerRegistry
async def list_servers(session: AsyncSession, ctx: RequestContext) -> list[MCPServer]:
    rows = await session.execute(select(MCPServer).where(MCPServer.tenant_id == ctx.tenant_id)
                                 .order_by(MCPServer.created_at, MCPServer.id))
    return list(rows.scalars().all())


async def get_server(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID) -> MCPServer:
    return await _get_server(session, ctx.tenant_id, server_id)


async def register_server(session: AsyncSession, ctx: RequestContext, body: MCPServerCreate) -> MCPServer:
    ctx.require(P.MCP_MANAGE)
    await _require_mcp_enabled(session, ctx.tenant_id)
    policy = _policy()
    existing = (await session.execute(select(func.count()).select_from(MCPServer)
                                      .where(MCPServer.tenant_id == ctx.tenant_id))).scalar_one()
    if existing >= policy.limits.max_servers_per_tenant:
        raise Conflict("The maximum number of MCP servers for this organization has been reached",
                       details={"limit": policy.limits.max_servers_per_tenant})
    duplicate = (await session.execute(select(MCPServer.id).where(
        MCPServer.tenant_id == ctx.tenant_id, MCPServer.name == body.name))).scalar_one_or_none()
    if duplicate is not None:
        raise Conflict("An MCP server with this name already exists", details={"name": body.name})
    if body.auth_credential_id is not None:
        credential = (await session.execute(select(ToolCredential.id).where(
            ToolCredential.id == body.auth_credential_id, ToolCredential.tenant_id == ctx.tenant_id)
        )).scalar_one_or_none()
        if credential is None:
            raise ValidationFailed("The referenced credential does not exist",
                                   details={"field": "auth_credential_id"})
    await _end_transaction(session)
    vetted = await policy.vet_server_url(body.url)  # DNS + private-address check, outside any transaction

    settings = get_settings()
    server = MCPServer(
        tenant_id=ctx.tenant_id, name=body.name, url=body.url, transport=MCPTransport.STREAMABLE_HTTP,
        status=MCPServerStatus.PENDING_REVIEW, auth_header_name=body.auth_header_name,
        auth_credential_id=body.auth_credential_id,
        auth_header_enc=(get_key_manager().encrypt(body.auth_header_value.get_secret_value())
                         if body.auth_header_value is not None else None),
        created_by=ctx.user_id,
        timeout_seconds=body.timeout_seconds or settings.mcp_call_timeout_seconds,
        rate_limit_per_minute=body.rate_limit_per_minute, server_info={},
    )
    session.add(server)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        raise Conflict("An MCP server with this name already exists", details={"name": body.name}) from exc
    has_auth = body.auth_header_value is not None or body.auth_credential_id is not None
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.register",
                 resource_type="mcp_server", resource_id=server.id,
                 metadata={"name": server.name, "host": vetted.host, "transport": server.transport,
                           "has_auth": has_auth})
    await _commit_and_refresh(session, server)
    return server


async def approve_server(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID) -> MCPServer:
    ctx.require(P.MCP_MANAGE)
    await _require_mcp_enabled(session, ctx.tenant_id)
    server = await _get_server(session, ctx.tenant_id, server_id)
    if server.status == MCPServerStatus.APPROVED:
        return server
    url = server.url
    await _end_transaction(session)
    await _policy().vet_server_url(url)  # the egress policy may have changed since registration
    server = await _get_server(session, ctx.tenant_id, server_id, for_update=True)
    previous = server.status
    server.status = MCPServerStatus.APPROVED
    server.approved_by = ctx.user_id
    server.approved_at = utcnow()
    server.last_error = None
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.approve",
                 resource_type="mcp_server", resource_id=server.id,
                 metadata={"name": server.name, "previous_status": previous})
    await _commit_and_refresh(session, server)
    return server


async def disable_server(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID) -> MCPServer:
    ctx.require(P.MCP_MANAGE)
    server = await _get_server(session, ctx.tenant_id, server_id, for_update=True)
    if server.status != MCPServerStatus.DISABLED:
        previous = server.status
        server.status = MCPServerStatus.DISABLED
        audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.disable",
                     resource_type="mcp_server", resource_id=server.id,
                     metadata={"name": server.name, "previous_status": previous})
    await _commit_and_refresh(session, server)
    return server


async def delete_server(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID) -> None:
    ctx.require(P.MCP_MANAGE)
    server = await _get_server(session, ctx.tenant_id, server_id, for_update=True)
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.delete",
                 resource_type="mcp_server", resource_id=server.id, metadata={"name": server.name})
    await session.delete(server)
    await session.commit()


# ---------------------------------------------------------------------------- MCPToolRegistry
async def list_tools(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID
                     ) -> tuple[MCPServer, list[MCPTool]]:
    server = await _get_server(session, ctx.tenant_id, server_id)
    rows = await session.execute(select(MCPTool).where(MCPTool.server_id == server.id,
                                                       MCPTool.tenant_id == ctx.tenant_id)
                                 .order_by(MCPTool.qualified_name))
    return server, list(rows.scalars().all())


def _normalize_listing(snapshot: ServerSnapshot, server_name: str
                       ) -> tuple[dict[str, NormalizedTool], list[RejectedTool]]:
    accepted: dict[str, NormalizedTool] = {}
    rejected: list[RejectedTool] = []
    for raw in snapshot.listing.tools:
        label = str(raw.get("name"))[:128] if isinstance(raw, dict) else "(invalid)"
        try:
            tool = normalize_remote_tool(raw, server_name)
        except MCPToolRejected as exc:
            rejected.append(RejectedTool(name=label, reason=exc.reason))
            continue
        if tool.qualified_name in accepted:
            rejected.append(RejectedTool(name=label, reason=f"name collides with another tool "
                                                            f"({tool.qualified_name})"))
            continue
        accepted[tool.qualified_name] = tool
    return accepted, rejected


def _apply_schema(row: MCPTool, tool: NormalizedTool) -> None:
    row.remote_name = tool.remote_name
    row.title = tool.title
    row.description = tool.description
    row.input_schema = tool.input_schema
    row.output_schema = tool.output_schema
    row.annotations = tool.annotations
    row.schema_hash = tool.schema_hash


async def _record_sync_failure(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID,
                               exc: AppError) -> None:
    if session.in_transaction():
        await session.rollback()
    try:
        server = await _get_server(session, ctx.tenant_id, server_id, for_update=True)
    except NotFound:
        return
    transient = exc.error_class in _TRANSIENT_CLASSES and not isinstance(exc, UnsafeURL)
    server.last_error = _safe_error(exc)
    if not transient and server.status == MCPServerStatus.APPROVED:
        server.status = MCPServerStatus.ERROR
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.sync",
                 status="failure", resource_type="mcp_server", resource_id=server.id,
                 metadata={"name": server.name, "error_code": exc.code, "transient": transient})
    await session.commit()


async def sync_tools(session: AsyncSession, ctx: RequestContext, server_id: uuid.UUID) -> MCPSyncResult:
    """Discover the server's tools and reconcile them with the stored, admin-reviewed rows."""
    ctx.require(P.MCP_MANAGE)
    await _require_mcp_enabled(session, ctx.tenant_id)
    server = await _get_server(session, ctx.tenant_id, server_id)
    if server.status not in (MCPServerStatus.APPROVED, MCPServerStatus.ERROR):
        raise InvalidStateTransition("Approve the MCP server before syncing its tools",
                                     details={"status": server.status})
    endpoint = await endpoint_for(session, server)
    server_name = server.name
    rate_limit = server.rate_limit_per_minute
    await _end_transaction(session)

    # A sync spends the same per-server budget as tool calls: the remote server is protected either way.
    await get_rate_limiter().enforce("mcp_server", str(server_id), rate_limit)
    try:
        snapshot = await get_mcp_connection_manager().discover(endpoint)
    except AppError as exc:
        await _record_sync_failure(session, ctx, server_id, exc)
        raise
    accepted, rejected = _normalize_listing(snapshot, server_name)

    server = await _get_server(session, ctx.tenant_id, server_id, for_update=True)
    existing = {row.qualified_name: row for row in (await session.execute(
        select(MCPTool).where(MCPTool.server_id == server.id, MCPTool.tenant_id == ctx.tenant_id))).scalars()}
    now = utcnow()
    result = MCPSyncResult(server=server_out(server), rejected=rejected, truncated=snapshot.listing.truncated)
    for name, tool in accepted.items():
        row = existing.get(name)
        if row is None:
            session.add(MCPTool(
                tenant_id=ctx.tenant_id, server_id=server.id, remote_name=tool.remote_name,
                qualified_name=name,
                title=tool.title, description=tool.description, input_schema=tool.input_schema,
                output_schema=tool.output_schema, annotations=tool.annotations, schema_hash=tool.schema_hash,
                approved_schema_hash=None, enabled=False, status=MCPToolStatus.ACTIVE, last_seen_at=now))
            result.added.append(name)
            continue
        row.last_seen_at = now
        if row.schema_hash == tool.schema_hash and row.status != MCPToolStatus.REMOVED:
            result.unchanged.append(name)
            continue
        _apply_schema(row, tool)
        if row.approved_schema_hash is not None and row.approved_schema_hash != tool.schema_hash:
            # Rug-pull protection: an approved tool changed under us -> off until re-approved.
            row.status = MCPToolStatus.SCHEMA_CHANGED
            row.enabled = False
            result.schema_changed.append(name)
        else:
            row.status = MCPToolStatus.ACTIVE
            result.updated.append(name)
    for name, row in existing.items():
        if name not in accepted and row.status != MCPToolStatus.REMOVED:
            row.status = MCPToolStatus.REMOVED
            row.enabled = False
            result.removed.append(name)

    server.protocol_version = snapshot.protocol_version
    server.server_info = snapshot.server_info
    server.last_sync_at = now
    server.last_error = None
    if server.status == MCPServerStatus.ERROR:
        server.status = MCPServerStatus.APPROVED
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.server.sync",
                 resource_type="mcp_server", resource_id=server.id,
                 metadata={"name": server.name, "added": len(result.added), "updated": len(result.updated),
                           "unchanged": len(result.unchanged), "schema_changed": result.schema_changed[:20],
                           "removed": result.removed[:20], "rejected": len(rejected),
                           "truncated": result.truncated})
    for name in result.schema_changed:
        audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="mcp.tool.schema_changed",
                     resource_type="mcp_tool", tool_name=name,
                     metadata={"server": server.name, "effect": "disabled pending re-approval"})
    await session.commit()
    server, tools = await list_tools(session, ctx, server_id)
    await _end_transaction(session)
    return result.model_copy(update={"server": server_out(server),
                                     "tools": [tool_out(t, server) for t in tools]})


async def update_tool(session: AsyncSession, ctx: RequestContext, tool_id: uuid.UUID, body: MCPToolUpdate
                      ) -> tuple[MCPTool, MCPServer]:
    """Admin decision. Enabling approves the tool's *current* schema hash."""
    ctx.require(P.MCP_MANAGE)
    found = await _get_tool_with_server(session, ctx.tenant_id, tool_id)
    if found is None:
        raise NotFound("MCP tool not found")
    tool, server = found
    changes: dict[str, Any] = {}
    if body.enabled is True:
        await _require_mcp_enabled(session, ctx.tenant_id)
        if server.status != MCPServerStatus.APPROVED:
            raise InvalidStateTransition("The MCP server must be approved before its tools can be enabled",
                                         details={"server_status": server.status})
        if tool.status == MCPToolStatus.REMOVED:
            raise InvalidStateTransition("The tool is no longer advertised by the server")
        if tool.approved_schema_hash != tool.schema_hash:
            changes["approved_schema_hash"] = [tool.approved_schema_hash, tool.schema_hash]
        tool.approved_schema_hash = tool.schema_hash
        tool.status = MCPToolStatus.ACTIVE
        tool.approved_by = ctx.user_id
        tool.approved_at = utcnow()
    if body.enabled is not None and body.enabled != tool.enabled:
        changes["enabled"] = [tool.enabled, body.enabled]
        tool.enabled = body.enabled
    if body.permission_level is not None and body.permission_level.value != tool.permission_level:
        changes["permission_level"] = [tool.permission_level, body.permission_level.value]
        tool.permission_level = body.permission_level.value
    if body.risk_level is not None and body.risk_level.value != tool.risk_level:
        changes["risk_level"] = [tool.risk_level, body.risk_level.value]
        tool.risk_level = body.risk_level.value
    if body.requires_approval is not None and body.requires_approval != tool.requires_approval:
        changes["requires_approval"] = [tool.requires_approval, body.requires_approval]
        tool.requires_approval = body.requires_approval
    audit.record(session, ctx=ctx, category=AuditCategory.INTEGRATION, action="mcp.tool.update",
                 resource_type="mcp_tool", resource_id=tool.id, tool_name=tool.qualified_name,
                 metadata={"server": server.name, "changes": changes})
    await _commit_and_refresh(session, tool, server)
    return tool, server


# ---------------------------------------------------------------------------- resolution
def _usable_tools_stmt(tenant_id: uuid.UUID) -> Any:
    return (
        select(MCPTool, MCPServer).join(MCPServer, MCPServer.id == MCPTool.server_id)
        .where(MCPTool.tenant_id == tenant_id, MCPServer.tenant_id == tenant_id,
               MCPTool.enabled.is_(True), MCPTool.status == MCPToolStatus.ACTIVE,
               MCPServer.status == MCPServerStatus.APPROVED, MCPTool.approved_schema_hash.is_not(None),
               MCPTool.schema_hash == MCPTool.approved_schema_hash)
    )


async def _mcp_available(session: AsyncSession, tenant_id: uuid.UUID) -> bool:
    return get_settings().mcp_enabled and await is_enabled(session, Flags.MCP, tenant_id)


async def resolve_mcp_tool(session: AsyncSession, tenant_id: uuid.UUID, name: str) -> Tool[Any, Any] | None:
    """The adapter for ``name`` if — and only if — it is an enabled, active, schema-approved tool on an
    approved server of *this* tenant."""
    if not _QUALIFIED_RE.match(name) or not name.startswith("mcp."):
        return None
    if not await _mcp_available(session, tenant_id):
        return None
    row = (await session.execute(_usable_tools_stmt(tenant_id).where(MCPTool.qualified_name == name))
           ).one_or_none()
    if row is None:
        return None
    tool, server = row[0], row[1]
    if not _policy().is_tool_usable(tool, server, tenant_id):
        return None
    return MCPToolAdapter(MCPToolBinding.from_rows(server, tool))


async def list_mcp_tools_for_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> list[Tool[Any, Any]]:
    if not await _mcp_available(session, tenant_id):
        return []
    rows = (await session.execute(_usable_tools_stmt(tenant_id).order_by(MCPTool.qualified_name)
                                  .limit(_MAX_TENANT_TOOLS))).all()
    policy = _policy()
    return [MCPToolAdapter(MCPToolBinding.from_rows(server, tool)) for tool, server in rows
            if policy.is_tool_usable(tool, server, tenant_id)]


async def load_call_endpoint(session: AsyncSession, tenant_id: uuid.UUID, tool_id: uuid.UUID,
                             expected_schema_hash: str) -> MCPEndpoint:
    """Re-check a tool right before a call and return its endpoint (with decrypted auth)."""
    if not await _mcp_available(session, tenant_id):
        raise FeatureDisabled(details={"flag": Flags.MCP})
    found = await _get_tool_with_server(session, tenant_id, tool_id)
    if found is None:
        raise PolicyDenied("This MCP tool is not available")
    tool, server = found
    _policy().ensure_tool_usable(tool, server, tenant_id)
    if tool.schema_hash != expected_schema_hash:
        raise PolicyDenied("The MCP tool changed since it was planned", details={"tool": tool.qualified_name})
    return await endpoint_for(session, server)


# ---------------------------------------------------------------------------- named facades
class MCPServerRegistry:
    """Tenant MCP servers: registration (SSRF-vetted, encrypted auth), admin review and lifecycle."""

    register = staticmethod(register_server)
    approve = staticmethod(approve_server)
    disable = staticmethod(disable_server)
    delete = staticmethod(delete_server)
    get = staticmethod(get_server)
    list_servers = staticmethod(list_servers)


class MCPToolRegistry:
    """Discovered MCP tools: sync (rug-pull protection), admin governance and per-tenant resolution."""

    sync = staticmethod(sync_tools)
    update = staticmethod(update_tool)
    list_tools = staticmethod(list_tools)
    resolve = staticmethod(resolve_mcp_tool)
    list_for_tenant = staticmethod(list_mcp_tools_for_tenant)
    load_call_endpoint = staticmethod(load_call_endpoint)
