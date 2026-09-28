from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class ToolDefinition(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Catalogue of tools (built-in rows are synced from code at startup/migration)."""

    __tablename__ = "tool_definitions"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    is_builtin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


class ToolVersion(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "tool_versions"

    tool_definition_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tool_definitions.id", ondelete="CASCADE"),
                                                          nullable=False)
    version: Mapped[str] = mapped_column(String(20), nullable=False)
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    output_schema: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    permission_level: Mapped[str] = mapped_column(String(24), nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    required_scopes: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    requires_approval: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_idempotency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    timeout_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    retry_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    audit_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    schema_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(nullable=False)

    __table_args__ = (UniqueConstraint("tool_definition_id", "version"),)


class ToolPermission(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Organization tool policy rule. ``tool_pattern`` is a glob (``gmail.*``); ``role`` NULL
    applies to all roles. Effects: deny | require_approval | allow (see PermissionService)."""

    __tablename__ = "tool_permissions"

    tool_pattern: Mapped[str] = mapped_column(String(128), nullable=False)
    role: Mapped[str | None] = mapped_column(String(60), nullable=True)
    effect: Mapped[str] = mapped_column(String(20), nullable=False)
    conditions: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    __table_args__ = (Index("ix_tool_permissions_tenant_pattern", "tenant_id", "tool_pattern"),)


class ToolCredential(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Tenant-owned secrets for tools (e.g. an MCP server bearer token, an API key).
    Encrypted at rest; never returned by the API."""

    __tablename__ = "tool_credentials"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    provider: Mapped[str] = mapped_column(String(60), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    secret_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    rotated_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "name"),)
