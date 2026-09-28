from __future__ import annotations

from fastapi import APIRouter, Response, status

from app.api.dependencies import Ctx, DbSession
from app.organizations import repository as org_repo
from app.organizations.schemas import OrganizationOut
from app.users import service
from app.users.schemas import AccountDeletionRequest, MeOut, UserOut, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=MeOut, summary="Current user, active organization and permissions")
async def me(ctx: Ctx, db: DbSession) -> MeOut:
    user = await service.get_me(db, ctx)
    return MeOut(**UserOut.model_validate(user).model_dump(), tenant_id=ctx.tenant_id, role=ctx.role,
                 permissions=sorted(ctx.permissions))


@router.patch("/me", response_model=UserOut, summary="Update profile (display name, timezone, locale)")
async def update_me(body: UserUpdate, ctx: Ctx, db: DbSession) -> UserOut:
    return UserOut.model_validate(await service.update_me(db, ctx, body))


@router.get("/me/organizations", response_model=list[OrganizationOut], summary="Organizations the user belongs to")
async def my_orgs(ctx: Ctx, db: DbSession) -> list[OrganizationOut]:
    rows = await org_repo.list_user_memberships(db, ctx.user_id)
    return [OrganizationOut.model_validate(org).model_copy(update={"role": role.name}) for _, role, org in rows]


@router.delete("/me", status_code=status.HTTP_202_ACCEPTED,
               summary="Delete account (right to delete). Revokes sessions now; purges data asynchronously.")
async def delete_me(body: AccountDeletionRequest, ctx: Ctx, db: DbSession) -> Response:
    await service.request_account_deletion(db, ctx, body.password, body.confirm)
    return Response(status_code=status.HTTP_202_ACCEPTED)
