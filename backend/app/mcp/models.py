"""MCP gateway ORM models.

``MCPServer`` is a tenant-registered remote MCP server. Only the Streamable HTTP
transport is supported for tenant servers: the stdio transport means spawning an
arbitrary local process chosen by a tenant, i.e. arbitrary code execution on our
workers, which is outside the sandbox boundary of a multi-tenant backend.

``MCPTool`` is one tool advertised by such a server. Advertising a tool grants
nothing: a tool is only usable after an admin enabled it (which pins
``approved_schema_hash``), its server is approved, its current schema still matches
the approved one, and it belongs to the caller's tenant. Server-provided MCP
annotations (``readOnlyHint``, ``destructiveHint``, …) are stored for reviewers but
are advisory only — the admin-assigned ``permission_level``/``risk_level`` govern.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.common.enums import PermissionLevel, RiskLevel
from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class MCPServerStatus:
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    DISABLED = "disabled"
    ERROR = "error"

    ALL = (PENDING_REVIEW, APPROVED, DISABLED, ERROR)


class MCPToolStatus:
    ACTIVE = "active"
    SCHEMA_CHANGED = "schema_changed"
    REMOVED = "removed"

    ALL = (ACTIVE, SCHEMA_CHANGED, REMOVED)


class MCPTransport:
    STREAMABLE_HTTP = "streamable_http"


class MCPServer(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """A tenant-registered remote MCP server (Streamable HTTP only)."""

    __tablename__ = "mcp_servers"

    name: Mapped[str] = mapped_column(String(41), nullable=False)
    url: Mapped[str] = mapped_column(String(2048), nullable=False)
    transport: Mapped[str] = mapped_column(String(32), nullable=False, default=MCPTransport.STREAMABLE_HTTP)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=MCPServerStatus.PENDING_REVIEW)
    # Authentication: either a reference to a tenant ToolCredential or an inline header value
    # encrypted with the KeyManager. Neither is ever returned by the API.
    auth_header_name: Mapped[str] = mapped_column(String(64), nullable=False, default="Authorization")
    auth_credential_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("tool_credentials.id", ondelete="SET NULL"), nullable=True)
    auth_header_enc: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    timeout_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    rate_limit_per_minute: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    protocol_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    server_info: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    last_sync_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "name"),
        Index("ix_mcp_servers_tenant_status", "tenant_id", "status"),
    )


class MCPTool(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """A tool advertised by an MCP server; unusable until an admin enables it."""

    __tablename__ = "mcp_tools"

    server_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mcp_servers.id", ondelete="CASCADE"),
                                                 nullable=False, index=True)
    remote_name: Mapped[str] = mapped_column(String(128), nullable=False)
    qualified_name: Mapped[str] = mapped_column(String(160), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    output_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    annotations: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    schema_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    approved_schema_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    permission_level: Mapped[str] = mapped_column(String(24), nullable=False,
                                                  default=PermissionLevel.HIGH_RISK_WRITE.value)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default=RiskLevel.HIGH.value)
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=MCPToolStatus.ACTIVE)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        UniqueConstraint("tenant_id", "qualified_name"),
        UniqueConstraint("server_id", "remote_name"),
        Index("ix_mcp_tools_tenant_enabled", "tenant_id", "enabled", "status"),
    )
