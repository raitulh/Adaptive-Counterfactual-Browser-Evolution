from __future__ import annotations

import re
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.enums import SystemRole
from app.common.ids import short_token
from app.core.config import get_settings
from app.core.database import elevated_system_scope
from app.core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from app.organizations import repository as repo
from app.organizations.models import Organization, OrganizationMember, Role
from app.organizations.schemas import MemberOut, OrganizationPolicy
from app.users.models import User


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "org"
    return f"{base}-{short_token(4).lower().replace('_', '').replace('-', '')[:6]}"


async def create_organization(session: AsyncSession, *, name: str, owner: User, personal: bool = False
                              ) -> Organization:
    settings = get_settings()
    # Creating a tenant (and its first membership) is inherently cross-tenant for the caller.
    with elevated_system_scope(session):
        org = Organization(name=name, slug=_slugify(name), plan=settings.default_plan, is_personal=personal,
                           data_region=settings.app_region, policy=OrganizationPolicy().model_dump())
        session.add(org)
        await session.flush()
        owner_role = await repo.get_role_by_name(session, SystemRole.OWNER.value)
        if owner_role is None:
            raise RuntimeError("system roles are not seeded; run migrations")
        session.add(OrganizationMember(tenant_id=org.id, user_id=owner.id, role_id=owner_role.id))
        await session.flush()
    return org


async def get_policy(session: AsyncSession, tenant_id: uuid.UUID) -> tuple[OrganizationPolicy, int]:
    org = await session.get(Organization, tenant_id)
    if org is None:
        raise NotFound("Organization not found")
    return OrganizationPolicy.model_validate(org.policy or {}), org.policy_version


async def update_policy(session: AsyncSession, ctx: RequestContext, policy: OrganizationPolicy) -> int:
    org = await session.get(Organization, ctx.tenant_id, with_for_update=True)
    if org is None:
        raise NotFound("Organization not found")
    org.policy = policy.model_dump()
    org.policy_version += 1
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="org.policy.update",
                 resource_type="organization", resource_id=org.id,
                 metadata={"policy_version": org.policy_version})
    await session.commit()
    return org.policy_version


async def list_members(session: AsyncSession, ctx: RequestContext) -> list[MemberOut]:
    rows = await session.execute(
        select(OrganizationMember, User, Role)
        .join(User, User.id == OrganizationMember.user_id)
        .join(Role, Role.id == OrganizationMember.role_id)
        .order_by(OrganizationMember.created_at)
    )
    return [
        MemberOut(id=m.id, user_id=u.id, email=u.email, display_name=u.display_name, role=r.name, status=m.status,
                  created_at=m.created_at)
        for m, u, r in rows.all()
    ]


async def add_member(session: AsyncSession, ctx: RequestContext, email: str, role_name: str) -> MemberOut:
    if role_name == SystemRole.OWNER.value and ctx.role != SystemRole.OWNER.value:
        raise Forbidden("Only owners can grant the owner role")
    user = (await session.execute(select(User).where(func.lower(User.email) == email.lower()))).scalar_one_or_none()
    if user is None or user.deleted_at is not None:
        # The invitee must register first; we do not create accounts on someone's behalf.
        raise NotFound("No active user with that e-mail address")
    role = await repo.get_role_by_name(session, role_name, ctx.tenant_id)
    if role is None:
        raise ValidationFailed("Unknown role")
    existing = (await session.execute(
        select(OrganizationMember).where(OrganizationMember.user_id == user.id))).scalar_one_or_none()
    if existing is not None:
        raise Conflict("User is already a member")
    member = OrganizationMember(tenant_id=ctx.tenant_id, user_id=user.id, role_id=role.id, invited_by=ctx.user_id)
    session.add(member)
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="org.member.add",
                 resource_type="user", resource_id=user.id, metadata={"role": role_name})
    await session.commit()
    return MemberOut(id=member.id, user_id=user.id, email=user.email, display_name=user.display_name,
                     role=role.name, status=member.status, created_at=member.created_at)


async def _owner_count(session: AsyncSession) -> int:
    owner_role = await repo.get_role_by_name(session, SystemRole.OWNER.value)
    assert owner_role is not None
    return int((await session.execute(
        select(func.count()).select_from(OrganizationMember)
        .where(OrganizationMember.role_id == owner_role.id, OrganizationMember.status == "active"))).scalar_one())


async def change_member_role(session: AsyncSession, ctx: RequestContext, member_id: uuid.UUID,
                             role_name: str) -> None:
    member = await session.get(OrganizationMember, member_id)
    if member is None:
        raise NotFound("Member not found")
    if role_name == SystemRole.OWNER.value and ctx.role != SystemRole.OWNER.value:
        raise Forbidden("Only owners can grant the owner role")
    role = await repo.get_role_by_name(session, role_name, ctx.tenant_id)
    if role is None:
        raise ValidationFailed("Unknown role")
    current_role = await session.get(Role, member.role_id)
    if current_role and current_role.name == SystemRole.OWNER.value and role_name != SystemRole.OWNER.value \
            and await _owner_count(session) <= 1:
        raise Conflict("An organization must keep at least one owner")
    member.role_id = role.id
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="org.member.role_change",
                 resource_type="organization_member", resource_id=member.id, metadata={"role": role_name})
    await session.commit()


async def remove_member(session: AsyncSession, ctx: RequestContext, member_id: uuid.UUID) -> None:
    from app.auth.service import revoke_user_sessions_in_tenant

    member = await session.get(OrganizationMember, member_id)
    if member is None:
        raise NotFound("Member not found")
    role = await session.get(Role, member.role_id)
    if role and role.name == SystemRole.OWNER.value and await _owner_count(session) <= 1:
        raise Conflict("An organization must keep at least one owner")
    await session.delete(member)
    await revoke_user_sessions_in_tenant(session, member.user_id, ctx.tenant_id, reason="membership_removed")
    audit.record(session, ctx=ctx, category=AuditCategory.ADMIN, action="org.member.remove",
                 resource_type="user", resource_id=member.user_id)
    await session.commit()
