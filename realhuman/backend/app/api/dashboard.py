from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import CurrentProject, DbSession, Now
from app.schemas.dashboard import OverviewOut, RequestLogOut, VerificationEventOut
from app.services import dashboard_service

router = APIRouter(prefix="/v1", tags=["dashboard"])


@router.get("/dashboard/overview", response_model=OverviewOut)
def overview(project: CurrentProject, db: DbSession, now: Now) -> OverviewOut:
    return dashboard_service.overview(db, project.id, now)


@router.get("/events", response_model=list[VerificationEventOut])
def events(
    project: CurrentProject, db: DbSession, limit: int = Query(default=20, ge=1, le=100)
) -> list[VerificationEventOut]:
    return dashboard_service.recent_events(db, project.id, limit)


@router.get("/logs", response_model=list[RequestLogOut])
def logs(
    project: CurrentProject, db: DbSession, limit: int = Query(default=30, ge=1, le=200)
) -> list[RequestLogOut]:
    return dashboard_service.request_logs(db, project.id, limit)
