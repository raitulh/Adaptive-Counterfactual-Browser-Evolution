"""Platform administration API (requires ``users.is_platform_admin``).

Cross-tenant reads use explicit system scope and every access is audited.
Organization-level administration (members, policies, tool rules) lives in the
organizations/tools routers behind organization RBAC instead.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, select, update

from app.api.dependencies import DbSession, require_platform_admin
from app.audit import service as audit
from app.audit.models import AuditLog
from app.audit.router import AuditOut
from app.audit.service import AuditCategory
from app.auth.service import revoke_all_sessions
from app.billing.plans import PLANS
from app.common.context import RequestContext
from app.common.feature_flags import DEFAULTS, clear_cache
from app.common.models import FeatureFlag, WorkerHeartbeat
from app.common.time import utcnow
from app.core.database import set_system_scope
from app.core.exceptions import NotFound, ValidationFailed
from app.organizations.models import Organization
from app.tasks.models import Task
from app.tasks.schemas import TaskOut
from app.usage.models import UsageEvent
from app.users.models import User, UserStatus
from app.workers.queues.models import Job

router = APIRouter(prefix="/admin", tags=["admin"])
Admin = Depends(require_platform_admin)


def _system(db: DbSession) -> None:
    set_system_scope(db)


class AdminUserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    email: str
    status: str
    is_platform_admin: bool
    mfa_enabled: bool
    created_at: datetime
    last_login_at: datetime | None


class AdminOrgOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    slug: str
    plan: str
    status: str
    data_region: str
    created_at: datetime


class UserStatusUpdate(BaseModel):
    status: Literal["active", "disabled"]
    reason: str = Field(min_length=1, max_length=500)


class OrgPlanUpdate(BaseModel):
    plan: str
    status: Literal["active", "suspended"] | None = None


class FlagIn(BaseModel):
    key: str = Field(min_length=1, max_length=100)
    tenant_id: uuid.UUID | None = None
    enabled: bool
    rollout_percentage: int = Field(default=100, ge=0, le=100)
    description: str | None = Field(default=None, max_length=500)


@router.get("/users", response_model=list[AdminUserOut], summary="Search users")
async def users(db: DbSession, ctx: RequestContext = Admin, email: str | None = Query(None, max_length=320),
                limit: int = Query(50, ge=1, le=200)) -> list[AdminUserOut]:
    stmt = select(User).order_by(User.created_at.desc()).limit(limit)
    if email:
        stmt = stmt.where(func.lower(User.email).contains(email.lower()))
    return [AdminUserOut.model_validate(u) for u in (await db.execute(stmt)).scalars().all()]


@router.patch("/users/{user_id}", response_model=AdminUserOut, summary="Disable / re-enable a user (revokes sessions)")
async def set_user_status(user_id: uuid.UUID, body: UserStatusUpdate, db: DbSession,
                          ctx: RequestContext = Admin) -> AdminUserOut:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    if user.id == ctx.user_id:
        raise ValidationFailed("Administrators cannot change their own status")
    user.status = UserStatus.ACTIVE if body.status == "active" else UserStatus.DISABLED
    if body.status == "disabled":
        await revoke_all_sessions(db, user.id, reason="admin_disabled")
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="admin.user.status", actor_type="admin",
                 resource_type="user", resource_id=user.id, metadata={"status": body.status, "reason": body.reason})
    await db.commit()
    return AdminUserOut.model_validate(user)


@router.get("/organizations", response_model=list[AdminOrgOut], summary="List organizations")
async def organizations(db: DbSession, ctx: RequestContext = Admin, limit: int = Query(50, ge=1, le=200)
                        ) -> list[AdminOrgOut]:
    rows = (await db.execute(select(Organization).order_by(Organization.created_at.desc()).limit(limit))).scalars()
    return [AdminOrgOut.model_validate(o) for o in rows]


@router.patch("/organizations/{org_id}", response_model=AdminOrgOut, summary="Change plan / suspend organization")
async def update_org(org_id: uuid.UUID, body: OrgPlanUpdate, db: DbSession, ctx: RequestContext = Admin
                     ) -> AdminOrgOut:
    if body.plan not in PLANS:
        raise ValidationFailed("Unknown plan")
    org = await db.get(Organization, org_id)
    if org is None:
        raise NotFound("Organization not found")
    org.plan = body.plan
    if body.status:
        org.status = body.status
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="admin.org.update", actor_type="admin",
                 tenant_id=org.id, resource_type="organization", resource_id=org.id, metadata=body.model_dump())
    await db.commit()
    return AdminOrgOut.model_validate(org)


@router.get("/security-events", response_model=list[AuditOut], summary="Recent security events across tenants")
async def security_events(db: DbSession, ctx: RequestContext = Admin, limit: int = Query(100, ge=1, le=500)
                          ) -> list[AuditOut]:
    rows = (await db.execute(select(AuditLog).where(AuditLog.category == AuditCategory.SECURITY)
                             .order_by(AuditLog.created_at.desc()).limit(limit))).scalars().all()
    return [AuditOut.model_validate(r) for r in rows]


@router.get("/tasks/{task_id}", response_model=TaskOut, summary="Inspect any task (audited)")
async def inspect_task(task_id: uuid.UUID, db: DbSession, ctx: RequestContext = Admin) -> TaskOut:
    _system(db)
    task = await db.get(Task, task_id)
    if task is None:
        raise NotFound("Task not found")
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="admin.task.inspect", actor_type="admin",
                 tenant_id=task.tenant_id, task_id=task.id)
    await db.commit()
    return TaskOut.model_validate(task)


@router.get("/system", summary="Workers, queue depth, dead letters, task states")
async def system(db: DbSession, ctx: RequestContext = Admin) -> dict[str, Any]:
    _system(db)
    now = utcnow()
    workers = (await db.execute(select(WorkerHeartbeat).order_by(WorkerHeartbeat.last_seen_at.desc()))).scalars()
    queue = (await db.execute(select(Job.queue, Job.status, func.count()).group_by(Job.queue, Job.status))).all()
    oldest = (await db.execute(select(Job.queue, func.min(Job.run_at)).where(Job.status == "pending")
                               .group_by(Job.queue))).all()
    tasks = (await db.execute(select(Task.status, func.count()).group_by(Task.status))).all()
    return {
        "workers": [{"worker_id": w.worker_id, "kind": w.kind, "queues": w.queues, "in_flight": w.jobs_in_flight,
                     "processed": w.jobs_processed, "last_seen_seconds_ago": (now - w.last_seen_at).total_seconds(),
                     "alive": now - w.last_seen_at < timedelta(seconds=60)} for w in workers],
        "queues": [{"queue": q, "status": s, "count": c} for q, s, c in queue],
        "oldest_pending": {q: (now - t).total_seconds() for q, t in oldest if t},
        "tasks_by_status": {s: c for s, c in tasks},
    }


@router.get("/jobs/dead", summary="Dead-lettered jobs")
async def dead_jobs(db: DbSession, ctx: RequestContext = Admin, limit: int = Query(50, ge=1, le=500)
                    ) -> list[dict[str, Any]]:
    _system(db)
    rows = (await db.execute(select(Job).where(Job.status == "dead").order_by(Job.finished_at.desc())
                             .limit(limit))).scalars()
    return [{"id": str(j.id), "queue": j.queue, "job_type": j.job_type, "attempts": j.attempts,
             "last_error": (j.last_error or "")[:500], "finished_at": j.finished_at,
             "tenant_id": str(j.tenant_id) if j.tenant_id else None} for j in rows]


@router.post("/jobs/{job_id}/retry", summary="Re-queue a dead-lettered job")
async def retry_job(job_id: uuid.UUID, db: DbSession, ctx: RequestContext = Admin) -> dict[str, str]:
    _system(db)
    result = await db.execute(update(Job).where(Job.id == job_id, Job.status == "dead").values(
        status="pending", attempts=0, run_at=utcnow(), finished_at=None))
    if not result.rowcount:  # type: ignore[attr-defined]
        raise NotFound("Dead job not found")
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="admin.job.retry", actor_type="admin",
                 resource_type="job", resource_id=job_id)
    await db.commit()
    return {"status": "requeued"}


@router.get("/usage", summary="Platform usage by tenant for the current month")
async def platform_usage(db: DbSession, ctx: RequestContext = Admin, limit: int = Query(50, ge=1, le=500)
                         ) -> list[dict[str, Any]]:
    _system(db)
    now = utcnow()
    since = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    rows = (await db.execute(select(UsageEvent.tenant_id, UsageEvent.kind, func.sum(UsageEvent.quantity),
                                    func.sum(UsageEvent.cost_micros)).where(UsageEvent.occurred_at >= since)
                             .group_by(UsageEvent.tenant_id, UsageEvent.kind).limit(limit * 10))).all()
    out: dict[str, dict[str, Any]] = {}
    for tenant_id, kind, qty, cost in rows:
        entry = out.setdefault(str(tenant_id), {"tenant_id": str(tenant_id), "usage": {}, "cost_usd": 0.0})
        entry["usage"][kind] = float(qty or 0)
        entry["cost_usd"] += float(cost or 0) / 1_000_000
    return sorted(out.values(), key=lambda e: -e["cost_usd"])[:limit]


@router.get("/feature-flags", summary="Feature flag defaults and overrides")
async def flags(db: DbSession, ctx: RequestContext = Admin) -> dict[str, Any]:
    rows = (await db.execute(select(FeatureFlag))).scalars()
    return {"defaults": DEFAULTS, "overrides": [
        {"key": r.key, "tenant_id": str(r.tenant_id) if r.tenant_id else None, "enabled": r.enabled,
         "rollout_percentage": r.rollout_percentage} for r in rows]}


@router.put("/feature-flags", summary="Create or update a flag override (global or per tenant)")
async def set_flag(body: FlagIn, db: DbSession, ctx: RequestContext = Admin) -> dict[str, Any]:
    row = (await db.execute(select(FeatureFlag).where(
        FeatureFlag.key == body.key,
        FeatureFlag.tenant_id.is_(None) if body.tenant_id is None else FeatureFlag.tenant_id == body.tenant_id)
    )).scalar_one_or_none()
    if row is None:
        row = FeatureFlag(key=body.key, tenant_id=body.tenant_id)
        db.add(row)
    row.enabled = body.enabled
    row.rollout_percentage = body.rollout_percentage
    row.description = body.description
    audit.record(db, ctx=ctx, category=AuditCategory.ADMIN, action="admin.feature_flag.set", actor_type="admin",
                 tenant_id=body.tenant_id, metadata=body.model_dump(mode="json"))
    await db.commit()
    clear_cache()
    return {"key": row.key, "enabled": row.enabled, "rollout_percentage": row.rollout_percentage}
