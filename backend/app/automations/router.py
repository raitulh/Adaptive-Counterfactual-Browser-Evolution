"""Automations API: recurring tasks owned by the caller."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, Request, Response, status
from fastapi.responses import JSONResponse

from app.api.dependencies import Ctx, DbSession, IdempotencyKeyHeader, require
from app.automations import service
from app.automations.schemas import AutomationCreate, AutomationOut, AutomationRunOut, AutomationUpdate
from app.common.context import RequestContext
from app.common.idempotency import run_idempotent
from app.common.pagination import Page
from app.core.config import get_settings
from app.organizations.rbac import P
from app.security.ratelimit import get_rate_limiter

router = APIRouter(prefix="/automations", tags=["automations"])


@router.get("", response_model=Page[AutomationOut], summary="List your automations (newest first)")
async def list_automations(ctx: Ctx, db: DbSession, cursor: str | None = Query(None, max_length=500),
                           limit: int = Query(50, ge=1, le=200)) -> Page[AutomationOut]:
    return await service.list_automations(db, ctx, cursor=cursor, limit=limit)


@router.post("", response_model=AutomationOut, status_code=status.HTTP_201_CREATED,
             summary="Create a scheduled automation (runs a task on a cron schedule)",
             responses={409: {"description": "Idempotency conflict"},
                        429: {"description": "Rate limit or plan automation limit reached"}})
async def create_automation(body: AutomationCreate, request: Request, db: DbSession,
                            ctx: RequestContext = Depends(require(P.AUTOMATIONS_MANAGE)),
                            idempotency_key: IdempotencyKeyHeader = None) -> JSONResponse:
    settings = get_settings()
    await get_rate_limiter().enforce("automation_create", str(ctx.user_id),
                                     settings.rate_limit_automation_create_per_hour, 3600)

    async def handler() -> tuple[int, AutomationOut]:
        automation = await service.create_automation(db, ctx, body)
        return status.HTTP_201_CREATED, AutomationOut.model_validate(automation)

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path,
                                  body.model_dump(mode="json"), handler)
    return JSONResponse(result.body, status_code=result.status_code,
                        headers={"Idempotent-Replayed": "true"} if result.replayed else None)


@router.get("/{automation_id}", response_model=AutomationOut, summary="Get one of your automations")
async def get_automation(automation_id: uuid.UUID, ctx: Ctx, db: DbSession) -> AutomationOut:
    return AutomationOut.model_validate(await service.get_automation(db, ctx, automation_id))


@router.patch("/{automation_id}", response_model=AutomationOut,
              summary="Update an automation (schedule, template, enabled, limits)")
async def update_automation(automation_id: uuid.UUID, body: AutomationUpdate, db: DbSession,
                            ctx: RequestContext = Depends(require(P.AUTOMATIONS_MANAGE))) -> AutomationOut:
    return AutomationOut.model_validate(await service.update_automation(db, ctx, automation_id, body))


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response,
               summary="Delete an automation (soft delete; stops future runs)")
async def delete_automation(automation_id: uuid.UUID, db: DbSession,
                            ctx: RequestContext = Depends(require(P.AUTOMATIONS_MANAGE))) -> Response:
    await service.delete_automation(db, ctx, automation_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{automation_id}/runs", response_model=Page[AutomationRunOut],
            summary="List an automation's runs (newest first)")
async def list_runs(automation_id: uuid.UUID, ctx: Ctx, db: DbSession,
                    cursor: str | None = Query(None, max_length=500),
                    limit: int = Query(50, ge=1, le=200)) -> Page[AutomationRunOut]:
    return await service.list_runs(db, ctx, automation_id, cursor=cursor, limit=limit)


@router.post("/{automation_id}/run-now", response_model=AutomationRunOut,
             status_code=status.HTTP_202_ACCEPTED,
             summary="Run an automation now (idempotent per minute: repeats return the same run)",
             responses={202: {"description": "Run materialized; its task is executed asynchronously"}})
async def run_now(automation_id: uuid.UUID, db: DbSession,
                  ctx: RequestContext = Depends(require(P.AUTOMATIONS_MANAGE))) -> JSONResponse:
    run, created = await service.run_now(db, ctx, automation_id)
    body = AutomationRunOut.model_validate(run).model_dump(mode="json")
    return JSONResponse(body, status_code=status.HTTP_202_ACCEPTED,
                        headers=None if created else {"Idempotent-Replayed": "true"})
