from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func, select

from app.api.dependencies import Ctx, DbSession
from app.billing.service import get_entitlements
from app.organizations.rbac import P
from app.usage.models import UsageAggregate, UsageEvent

router = APIRouter(prefix="/usage", tags=["usage"])


class UsageSummary(BaseModel):
    period_start: date
    scope: str
    totals: dict[str, float]
    cost_usd: float
    plan: str
    quotas: dict[str, float]
    by_day: list[dict[str, Any]]


@router.get("", response_model=UsageSummary, summary="Usage for the current month (yours, or org-wide for admins)")
async def usage(ctx: Ctx, db: DbSession, org_wide: bool = Query(False)) -> UsageSummary:
    ctx.require(P.USAGE_READ)
    now = datetime.now(UTC)
    since = datetime(now.year, now.month, 1, tzinfo=UTC)
    org = org_wide and ctx.has(P.AUDIT_READ)
    stmt = select(UsageEvent.kind, func.sum(UsageEvent.quantity), func.sum(UsageEvent.cost_micros)).where(
        UsageEvent.occurred_at >= since)
    if not org:
        stmt = stmt.where(UsageEvent.user_id == ctx.user_id)
    rows = (await db.execute(stmt.group_by(UsageEvent.kind))).all()
    totals = {kind: float(q or 0) for kind, q, _ in rows}
    cost = sum(float(c or 0) for _, _, c in rows) / 1_000_000
    daily = select(UsageAggregate.period_start, UsageAggregate.kind, func.sum(UsageAggregate.quantity)).where(
        UsageAggregate.period == "day", UsageAggregate.period_start >= since.date())
    if not org:
        daily = daily.where(UsageAggregate.user_id == ctx.user_id)
    by_day = [{"date": d.isoformat(), "kind": k, "quantity": float(q or 0)}
              for d, k, q in (await db.execute(daily.group_by(UsageAggregate.period_start, UsageAggregate.kind)
                                               .order_by(UsageAggregate.period_start))).all()]
    ent = await get_entitlements(db, ctx.tenant_id)
    return UsageSummary(period_start=since.date(), scope="organization" if org else "user", totals=totals,
                        cost_usd=round(cost, 6), plan=ent.plan.name, quotas=dict(ent.plan.monthly_quotas),
                        by_day=by_day)
