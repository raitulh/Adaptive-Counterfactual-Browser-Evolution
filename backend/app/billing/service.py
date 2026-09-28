"""Billing abstraction. Domain modules depend on ``EntitlementService`` only; the
payment provider (Stripe, etc.) sits behind ``BillingProvider``."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.models import Subscription
from app.billing.plans import Plan, get_plan
from app.core.exceptions import FeatureDisabled
from app.organizations.models import Organization


class BillingProvider(Protocol):
    name: str

    async def create_customer(self, tenant_id: uuid.UUID, email: str) -> str: ...

    async def change_plan(self, tenant_id: uuid.UUID, plan: str) -> dict[str, Any]: ...

    async def report_usage(self, tenant_id: uuid.UUID, kind: str, quantity: float) -> None: ...


class NoopBillingProvider:
    """No payment processor: plans are assigned administratively. Usage is still metered."""

    name = "none"

    async def create_customer(self, tenant_id: uuid.UUID, email: str) -> str:
        return f"local-{tenant_id}"

    async def change_plan(self, tenant_id: uuid.UUID, plan: str) -> dict[str, Any]:
        return {"plan": plan, "status": "active"}

    async def report_usage(self, tenant_id: uuid.UUID, kind: str, quantity: float) -> None:
        return None


@dataclass(slots=True)
class Entitlements:
    plan: Plan

    def has_feature(self, feature: str) -> bool:
        return feature in self.plan.features

    def require_feature(self, feature: str) -> None:
        if not self.has_feature(feature):
            raise FeatureDisabled(f"Your plan does not include '{feature}'", details={"plan": self.plan.name})


async def get_entitlements(session: AsyncSession, tenant_id: uuid.UUID) -> Entitlements:
    sub = (await session.execute(
        select(Subscription).where(Subscription.tenant_id == tenant_id, Subscription.status == "active")
        .order_by(Subscription.created_at.desc()).limit(1),
        execution_options={"skip_tenant_scope": True},
    )).scalar_one_or_none()
    if sub is not None:
        return Entitlements(get_plan(sub.plan))
    org = await session.get(Organization, tenant_id)
    return Entitlements(get_plan(org.plan if org else "free"))


def get_billing_provider() -> BillingProvider:
    return NoopBillingProvider()
