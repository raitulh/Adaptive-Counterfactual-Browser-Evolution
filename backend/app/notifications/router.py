from __future__ import annotations

import uuid

from fastapi import APIRouter, Query, Response, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update

from app.api.dependencies import Ctx, DbSession
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.common.time import utcnow
from app.notifications.models import Notification

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    channel: str
    event_type: str
    title: str
    body: str
    data: dict
    status: str
    read_at: object | None
    created_at: object


@router.get("", response_model=Page[NotificationOut], summary="List in-app notifications")
async def list_notifications(ctx: Ctx, db: DbSession, unread_only: bool = False, cursor: str | None = None,
                             limit: int = Query(50, ge=1, le=200)) -> Page[NotificationOut]:
    lim = clamp_limit(limit)
    stmt = select(Notification).where(Notification.user_id == ctx.user_id, Notification.channel == "in_app")
    if unread_only:
        stmt = stmt.where(Notification.read_at.is_(None))
    rows = list((await db.execute(apply_keyset(stmt, Notification, cursor, lim))).scalars().all())
    return build_page(rows, lim, NotificationOut.model_validate)


@router.post("/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT, summary="Mark as read")
async def mark_read(notification_id: uuid.UUID, ctx: Ctx, db: DbSession) -> Response:
    await db.execute(update(Notification).where(Notification.id == notification_id,
                                                Notification.user_id == ctx.user_id).values(read_at=utcnow()))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/read-all", status_code=status.HTTP_204_NO_CONTENT, summary="Mark all as read")
async def mark_all_read(ctx: Ctx, db: DbSession) -> Response:
    await db.execute(update(Notification).where(Notification.user_id == ctx.user_id,
                                                Notification.read_at.is_(None)).values(read_at=utcnow()))
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
