from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, UniqueConstraint
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


class Organization(UUIDPrimaryKeyMixin, TimestampMixin, SoftDeleteMixin, VersionedMixin, Base):
    """The tenant root. ``tenant_id`` on every scoped row references this table."""

    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    plan: Mapped[str] = mapped_column(String(30), nullable=False, default="free")
    is_personal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Where this tenant's data lives; groundwork for residency-aware routing.
    data_region: Mapped[str] = mapped_column(String(40), nullable=False, default="local")
    # Tenant policy (tool/approval/egress settings). Validated by OrganizationPolicy.
    policy: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    policy_version: Mapped[int] = mapped_column(nullable=False, default=1)


class Permission(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class Role(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """System roles have tenant_id NULL; organizations may define custom roles."""

    __tablename__ = "roles"

    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("uq_roles_tenant_name", "tenant_id", "name", unique=True, postgresql_nulls_not_distinct=True),
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True
    )


class OrganizationMember(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    __tablename__ = "organization_members"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    invited_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    __table_args__ = (UniqueConstraint("tenant_id", "user_id"),)
