from __future__ import annotations

import uuid
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse

from app.api.dependencies import Ctx, DbSession, require
from app.common.context import RequestContext
from app.core.config import get_settings
from app.core.exceptions import AppError
from app.integrations import service
from app.integrations.schemas import ConnectGoogleRequest, ConnectGoogleResponse, ConnectionOut
from app.organizations.rbac import P

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("", response_model=list[ConnectionOut], summary="List the user's connected accounts (no tokens)")
async def list_integrations(ctx: Ctx, db: DbSession) -> list[ConnectionOut]:
    return await service.list_connections(db, ctx)


@router.post("/google/connect", response_model=ConnectGoogleResponse,
             summary="Start connecting Google (Gmail/Calendar/Drive/Contacts) with least-privilege scopes")
async def connect_google(body: ConnectGoogleRequest,
                         ctx: RequestContext = Depends(require(P.INTEGRATIONS_MANAGE))) -> ConnectGoogleResponse:
    url, scopes = await service.start_google_connect(ctx, body.capabilities, body.login_hint)
    return ConnectGoogleResponse(authorization_url=url, requested_scopes=scopes)


@router.get("/google/callback", summary="OAuth redirect target (authenticated by the single-use state)",
            response_class=RedirectResponse, status_code=302)
async def google_callback(db: DbSession, code: str | None = Query(None, max_length=2048),
                          state: str = Query(max_length=128), error: str | None = Query(None, max_length=200)
                          ) -> RedirectResponse:
    settings = get_settings()
    if error or not code:
        return RedirectResponse(f"{settings.frontend_oauth_error_url}&{urlencode({'reason': error or 'no_code'})}",
                                status_code=302)
    try:
        await service.complete_google_connect(db, code=code, state=state)
    except AppError as exc:
        return RedirectResponse(f"{settings.frontend_oauth_error_url}&{urlencode({'reason': exc.code})}",
                                status_code=302)
    return RedirectResponse(settings.frontend_oauth_success_url, status_code=302)


@router.post("/{connection_id}/check", response_model=ConnectionOut,
             summary="Refresh tokens now and report connected/expired/revoked/insufficient_scope status")
async def check(connection_id: uuid.UUID, ctx: Ctx, db: DbSession) -> ConnectionOut:
    conn = await service.check_connection(db, ctx, connection_id)
    return await service.to_out(db, conn)


@router.post("/{connection_id}/disconnect", response_model=ConnectionOut,
             summary="Disconnect and revoke the provider tokens")
async def disconnect(connection_id: uuid.UUID, db: DbSession,
                     ctx: RequestContext = Depends(require(P.INTEGRATIONS_MANAGE))) -> ConnectionOut:
    conn = await service.disconnect(db, ctx, connection_id)
    return await service.to_out(db, conn)
