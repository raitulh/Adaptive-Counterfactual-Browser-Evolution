from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response, status

from app.api.dependencies import Ctx, DbSession, require
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.core.exceptions import NotFound
from app.organizations import service
from app.organizations.models import Organization
from app.organizations.rbac import P
from app.organizations.schemas import (
    MemberAdd,
    MemberOut,
    MemberRoleUpdate,
    OrganizationCreate,
    OrganizationOut,
    OrganizationPolicy,
    OrganizationUpdate,
    PolicyOut,
)
from app.users.models import User

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.post("", response_model=OrganizationOut, status_code=status.HTTP_201_CREATED,
             summary="Create an organization (caller becomes owner)")
async def create_org(body: OrganizationCreate, ctx: Ctx, db: DbSession) -> OrganizationOut:
    user = await db.get(User, ctx.user_id)
    assert user is not None
    org = await service.create_organization(db, name=body.name, owner=user)
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="org.create", tenant_id=org.id,
                 resource_type="organization", resource_id=org.id)
    await db.commit()
    return OrganizationOut.model_validate(org).model_copy(update={"role": "owner"})


@router.get("/current", response_model=OrganizationOut, summary="The active organization")
async def current_org(ctx: Ctx, db: DbSession) -> OrganizationOut:
    org = await db.get(Organization, ctx.tenant_id)
    if org is None:
        raise NotFound()
    return OrganizationOut.model_validate(org).model_copy(update={"role": ctx.role})


@router.patch("/current", response_model=OrganizationOut, summary="Rename the active organization")
async def update_org(body: OrganizationUpdate, db: DbSession,
                     ctx: RequestContext = Depends(require(P.ORG_MANAGE))) -> OrganizationOut:
    org = await db.get(Organization, ctx.tenant_id)
    if org is None:
        raise NotFound()
    if body.name:
        org.name = body.name
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="org.update", resource_type="organization",
                 resource_id=org.id)
    await db.commit()
    return OrganizationOut.model_validate(org).model_copy(update={"role": ctx.role})


@router.get("/current/policy", response_model=PolicyOut, summary="Organization execution policy")
async def get_policy(ctx: Ctx, db: DbSession) -> PolicyOut:
    policy, version = await service.get_policy(db, ctx.tenant_id)
    return PolicyOut(policy=policy, policy_version=version)


@router.put("/current/policy", response_model=PolicyOut, summary="Replace organization execution policy")
async def put_policy(body: OrganizationPolicy, db: DbSession,
                     ctx: RequestContext = Depends(require(P.ORG_MANAGE))) -> PolicyOut:
    version = await service.update_policy(db, ctx, body)
    return PolicyOut(policy=body, policy_version=version)


@router.get("/current/members", response_model=list[MemberOut], summary="List members")
async def members(ctx: Ctx, db: DbSession) -> list[MemberOut]:
    return await service.list_members(db, ctx)


@router.post("/current/members", response_model=MemberOut, status_code=status.HTTP_201_CREATED,
             summary="Add an existing user as a member")
async def add_member(body: MemberAdd, db: DbSession,
                     ctx: RequestContext = Depends(require(P.MEMBERS_MANAGE))) -> MemberOut:
    return await service.add_member(db, ctx, body.email, body.role.value)


@router.patch("/current/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Change member role")
async def change_role(member_id: uuid.UUID, body: MemberRoleUpdate, db: DbSession,
                      ctx: RequestContext = Depends(require(P.MEMBERS_MANAGE))) -> Response:
    await service.change_member_role(db, ctx, member_id, body.role.value)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/current/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Remove member")
async def remove_member(member_id: uuid.UUID, db: DbSession,
                        ctx: RequestContext = Depends(require(P.MEMBERS_MANAGE))) -> Response:
    await service.remove_member(db, ctx, member_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
