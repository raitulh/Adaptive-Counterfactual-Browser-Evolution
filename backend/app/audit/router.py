from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.api.dependencies import DbSession, require
from app.audit.models import AuditLog
from app.common.context import RequestContext
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.organizations.rbac import P

router = APIRouter(prefix="/audit", tags=["audit"])


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    user_id: uuid.UUID | None
    actor_type: str
    category: str
    action: str
    status: str
    resource_type: str | None
    resource_id: str | None
    task_id: uuid.UUID | None
    step_id: uuid.UUID | None
    tool_name: str | None
    approval_id: uuid.UUID | None
    ip_address: str | None
    request_id: str | None
    result_summary: str | None
    metadata: dict[str, Any] = Field(validation_alias="metadata_")
    created_at: datetime


@router.get("", response_model=Page[AuditOut], summary="Organization audit log (append-only)")
async def list_audit(db: DbSession, ctx: RequestContext = Depends(require(P.AUDIT_READ)),
                     category: str | None = Query(None, max_length=30), action: str | None = Query(None, max_length=100),
                     task_id: uuid.UUID | None = None, user_id: uuid.UUID | None = None, cursor: str | None = None,
                     limit: int = Query(100, ge=1, le=500)) -> Page[AuditOut]:
    lim = clamp_limit(limit)
    # audit_logs is not a TenantScopedMixin table (platform events have no tenant): filter explicitly.
    stmt = select(AuditLog).where(AuditLog.tenant_id == ctx.tenant_id)
    if category:
        stmt = stmt.where(AuditLog.category == category)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if task_id:
        stmt = stmt.where(AuditLog.task_id == task_id)
    if user_id:
        stmt = stmt.where(AuditLog.user_id == user_id)
    rows = list((await db.execute(apply_keyset(stmt, AuditLog, cursor, lim))).scalars().all())
    return build_page(rows, lim, AuditOut.model_validate)
