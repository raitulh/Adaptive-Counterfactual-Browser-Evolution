from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.dependencies import Ctx, DbSession
from app.billing.plans import PLANS
from app.billing.service import get_billing_provider, get_entitlements

router = APIRouter(prefix="/billing", tags=["billing"])


class PlanOut(BaseModel):
    name: str
    display_name: str
    monthly_quotas: dict[str, float]
    features: list[str]
    max_concurrent_tasks: int
    max_automations: int
    max_members: int


class EntitlementsOut(BaseModel):
    plan: PlanOut
    billing_provider: str


def _plan_out(name: str) -> PlanOut:
    p = PLANS[name]
    return PlanOut(name=p.name, display_name=p.display_name, monthly_quotas=dict(p.monthly_quotas),
                   features=sorted(p.features), max_concurrent_tasks=p.max_concurrent_tasks,
                   max_automations=p.max_automations, max_members=p.max_members)


@router.get("/plans", response_model=list[PlanOut], summary="Available plans")
async def plans() -> list[PlanOut]:
    return [_plan_out(n) for n in PLANS]


@router.get("/entitlements", response_model=EntitlementsOut, summary="Current plan and entitlements")
async def entitlements(ctx: Ctx, db: DbSession) -> EntitlementsOut:
    ent = await get_entitlements(db, ctx.tenant_id)
    return EntitlementsOut(plan=_plan_out(ent.plan.name), billing_provider=get_billing_provider().name)
