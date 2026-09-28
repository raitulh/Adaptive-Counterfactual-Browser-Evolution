from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import (
    Base,
    SoftDeleteMixin,
    TenantScopedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    VersionedMixin,
)


class Agent(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, VersionedMixin, Base):
    __tablename__ = "agents"

    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_versions.id", ondelete="SET NULL", use_alter=True), nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "name"),)


class AgentVersion(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Immutable agent configuration snapshot; tasks reference the exact version they ran."""

    __tablename__ = "agent_versions"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), nullable=False,
                                                index=True)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    tool_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    memory_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    execution_limits: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    verification_policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)
    created_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    __table_args__ = (UniqueConstraint("agent_id", "version_number"),)


class AgentConfig(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Mutable per-agent settings that are not part of the reproducible version (e.g. display)."""

    __tablename__ = "agent_configs"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    value: Mapped[Any] = mapped_column(JSONB, nullable=True)

    __table_args__ = (UniqueConstraint("agent_id", "key"),)
