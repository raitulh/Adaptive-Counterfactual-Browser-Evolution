"""MCP gateway API schemas. Secrets are write-only: no output schema carries them."""

from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator, model_validator

from app.common.enums import PermissionLevel, RiskLevel

SERVER_NAME_PATTERN = r"^[a-z][a-z0-9_]{1,40}$"
QUALIFIED_NAME_PATTERN = r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2}$"
HEADER_NAME_PATTERN = r"^[A-Za-z][A-Za-z0-9-]{0,63}$"

# Headers the gateway controls itself; a tenant may not override them with its auth header.
RESERVED_HEADERS = frozenset({
    "host", "content-type", "content-length", "accept", "accept-encoding", "connection", "transfer-encoding",
    "user-agent", "mcp-session-id", "mcp-protocol-version", "cookie", "origin", "te", "upgrade",
    "proxy-authorization", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-real-ip",
})


class MCPServerCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=SERVER_NAME_PATTERN, description="Slug used in tool names: mcp.<name>.<tool>")
    url: str = Field(min_length=8, max_length=2048, description="Streamable HTTP endpoint (https://…/mcp)")
    transport: Literal["streamable_http"] = Field(
        default="streamable_http",
        description="Only Streamable HTTP is supported; stdio would mean running tenant-chosen processes.")
    auth_header_name: str = Field(default="Authorization", pattern=HEADER_NAME_PATTERN)
    auth_header_value: SecretStr | None = Field(
        default=None, description="Header value sent to the server (e.g. 'Bearer …'). Stored encrypted.")
    auth_credential_id: uuid.UUID | None = Field(
        default=None, description="Use an existing tool credential as the header value instead.")
    timeout_seconds: float | None = Field(default=None, ge=0.5, le=120)
    rate_limit_per_minute: int = Field(default=60, ge=1, le=600)

    @field_validator("url")
    @classmethod
    def _strip_url(cls, value: str) -> str:
        value = value.strip()
        if any(ch.isspace() for ch in value):
            raise ValueError("URL must not contain whitespace")
        return value

    @field_validator("auth_header_name")
    @classmethod
    def _header_allowed(cls, value: str) -> str:
        if value.lower() in RESERVED_HEADERS:
            raise ValueError("this header is controlled by the gateway")
        return value

    @field_validator("auth_header_value")
    @classmethod
    def _header_value(cls, value: SecretStr | None) -> SecretStr | None:
        if value is None:
            return None
        raw = value.get_secret_value()
        if not raw or len(raw) > 4096 or re.search(r"[\x00-\x1f\x7f]", raw):
            raise ValueError("header value must be 1-4096 printable characters")
        return value

    @model_validator(mode="after")
    def _one_auth_source(self) -> MCPServerCreate:
        if self.auth_header_value is not None and self.auth_credential_id is not None:
            raise ValueError("provide either auth_header_value or auth_credential_id, not both")
        return self


class MCPServerOut(BaseModel):
    """Server as returned by the API. Never contains credentials."""

    id: uuid.UUID
    name: str
    url: str
    transport: str
    status: str
    has_auth: bool
    auth_header_name: str | None
    auth_credential_id: uuid.UUID | None
    created_by: uuid.UUID | None
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    timeout_seconds: float
    rate_limit_per_minute: int
    protocol_version: str | None
    server_info: dict[str, Any]
    last_sync_at: datetime | None
    last_error: str | None
    created_at: datetime
    updated_at: datetime


class MCPToolOut(BaseModel):
    id: uuid.UUID
    server_id: uuid.UUID
    remote_name: str
    qualified_name: str
    title: str | None
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    annotations: dict[str, Any] = Field(description="Server-provided hints; advisory only, never trusted")
    schema_hash: str
    approved_schema_hash: str | None
    schema_approved: bool
    permission_level: PermissionLevel
    risk_level: RiskLevel
    requires_approval: bool
    enabled: bool
    status: str
    usable: bool = Field(description="Enabled, active, schema approved and server approved")
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    last_seen_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MCPToolUpdate(BaseModel):
    """Admin decision about one tool. Enabling approves the tool's *current* schema."""

    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    permission_level: PermissionLevel | None = None
    risk_level: RiskLevel | None = None
    requires_approval: bool | None = None

    @model_validator(mode="after")
    def _not_empty(self) -> MCPToolUpdate:
        fields = (self.enabled, self.permission_level, self.risk_level, self.requires_approval)
        if all(value is None for value in fields):
            raise ValueError("at least one field must be provided")
        return self


class RejectedTool(BaseModel):
    name: str
    reason: str


class MCPSyncResult(BaseModel):
    server: MCPServerOut
    added: list[str] = Field(default_factory=list)
    updated: list[str] = Field(default_factory=list)
    unchanged: list[str] = Field(default_factory=list)
    schema_changed: list[str] = Field(default_factory=list, description="Disabled pending re-approval")
    removed: list[str] = Field(default_factory=list)
    rejected: list[RejectedTool] = Field(default_factory=list)
    truncated: bool = Field(default=False,
                            description="The server advertised more tools than the gateway accepts")
    tools: list[MCPToolOut] = Field(default_factory=list)
