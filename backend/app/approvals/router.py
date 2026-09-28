from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.api.dependencies import Ctx, DbSession, IdempotencyKeyHeader
from app.approvals import service
from app.approvals.models import ApprovalRequest
from app.approvals.schemas import ApprovalOut, ApproveRequest, RejectRequest
from app.common.idempotency import run_idempotent
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.core.exceptions import NotFound
from app.organizations.rbac import P

router = APIRouter(prefix="/approvals", tags=["approvals"])


@router.get("", response_model=Page[ApprovalOut], summary="List approval requests (own, or all with approvals:decide_any)")
async def list_approvals(ctx: Ctx, db: DbSession, status: str | None = Query(None, pattern="^(pending|approved|rejected|expired|cancelled)$"),
                         task_id: uuid.UUID | None = None, cursor: str | None = None,
                         limit: int = Query(50, ge=1, le=200)) -> Page[ApprovalOut]:
    lim = clamp_limit(limit)
    stmt = select(ApprovalRequest)
    if not ctx.has(P.APPROVALS_DECIDE_ANY):
        stmt = stmt.where(ApprovalRequest.user_id == ctx.user_id)
    if status:
        stmt = stmt.where(ApprovalRequest.status == status)
    if task_id:
        stmt = stmt.where(ApprovalRequest.task_id == task_id)
    rows = list((await db.execute(apply_keyset(stmt, ApprovalRequest, cursor, lim))).scalars().all())
    return build_page(rows, lim, ApprovalOut.model_validate)


@router.get("/{approval_id}", response_model=ApprovalOut, summary="Get an approval request")
async def get_approval(approval_id: uuid.UUID, ctx: Ctx, db: DbSession) -> ApprovalOut:
    approval = await db.get(ApprovalRequest, approval_id)
    if approval is None or (approval.user_id != ctx.user_id and not ctx.has(P.APPROVALS_DECIDE_ANY)):
        raise NotFound("Approval not found")
    return ApprovalOut.model_validate(approval)


@router.post("/{approval_id}/approve", response_model=ApprovalOut,
             summary="Approve a pending action (re-checked at execution; single use; expires)",
             responses={404: {"description": "Not found or not yours"}, 409: {"description": "Not pending/expired"}})
async def approve(approval_id: uuid.UUID, request: Request, ctx: Ctx, db: DbSession,
                  idempotency_key: IdempotencyKeyHeader = None, body: ApproveRequest | None = None) -> JSONResponse:
    async def handler() -> tuple[int, ApprovalOut]:
        return 200, ApprovalOut.model_validate(await service.approve(db, ctx, approval_id, body.note if body else None))

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path, {"note": body.note if body else None},
                                  handler)
    return JSONResponse(result.body, status_code=result.status_code,
                        headers={"Idempotent-Replayed": "true"} if result.replayed else None)


@router.post("/{approval_id}/reject", response_model=ApprovalOut, summary="Reject a pending action")
async def reject(approval_id: uuid.UUID, body: RejectRequest, request: Request, ctx: Ctx, db: DbSession,
                 idempotency_key: IdempotencyKeyHeader = None) -> JSONResponse:
    async def handler() -> tuple[int, ApprovalOut]:
        return 200, ApprovalOut.model_validate(await service.reject(db, ctx, approval_id, body.reason))

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path, body.model_dump(), handler)
    return JSONResponse(result.body, status_code=result.status_code,
                        headers={"Idempotent-Replayed": "true"} if result.replayed else None)
