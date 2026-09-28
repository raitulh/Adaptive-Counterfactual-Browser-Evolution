from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.organizations.models import Organization, OrganizationMember, Permission, Role, RolePermission

_NO_SCOPE = {"skip_tenant_scope": True}


async def get_role_by_name(session: AsyncSession, name: str, tenant_id: uuid.UUID | None = None) -> Role | None:
    stmt = select(Role).where(Role.name == name)
    stmt = stmt.where(Role.tenant_id.is_(None)) if tenant_id is None else stmt.where(
        (Role.tenant_id == tenant_id) | Role.tenant_id.is_(None))
    stmt = stmt.order_by(Role.tenant_id.is_(None))  # prefer tenant-specific role over system role
    return (await session.execute(stmt)).scalars().first()


async def role_permissions(session: AsyncSession, role_id: uuid.UUID) -> frozenset[str]:
    rows = await session.execute(
        select(Permission.code).join(RolePermission, RolePermission.permission_id == Permission.id)
        .where(RolePermission.role_id == role_id)
    )
    return frozenset(rows.scalars().all())


async def get_active_membership(session: AsyncSession, user_id: uuid.UUID, tenant_id: uuid.UUID
                                ) -> tuple[OrganizationMember, Role, Organization] | None:
    stmt = (
        select(OrganizationMember, Role, Organization)
        .join(Role, Role.id == OrganizationMember.role_id)
        .join(Organization, Organization.id == OrganizationMember.tenant_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.tenant_id == tenant_id,
            OrganizationMember.status == "active",
            Organization.status == "active",
            Organization.deleted_at.is_(None),
        )
    )
    row = (await session.execute(stmt, execution_options=_NO_SCOPE)).first()
    return (row[0], row[1], row[2]) if row else None


async def list_user_memberships(session: AsyncSession, user_id: uuid.UUID
                                ) -> list[tuple[OrganizationMember, Role, Organization]]:
    stmt = (
        select(OrganizationMember, Role, Organization)
        .join(Role, Role.id == OrganizationMember.role_id)
        .join(Organization, Organization.id == OrganizationMember.tenant_id)
        .where(OrganizationMember.user_id == user_id, OrganizationMember.status == "active",
               Organization.deleted_at.is_(None))
        .order_by(Organization.created_at)
    )
    return [(r[0], r[1], r[2]) for r in (await session.execute(stmt, execution_options=_NO_SCOPE)).all()]
