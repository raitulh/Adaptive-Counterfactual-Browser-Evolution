"""Usage metering, aggregation and quota enforcement."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.billing.plans import get_plan
from app.common.ids import new_id
from app.common.time import utcnow
from app.core.exceptions import QuotaExceeded
from app.model_gateway.types import CallMetadata, ModelResponse
from app.usage.models import UsageEvent, UsageKind

logger = logging.getLogger(__name__)


def add_usage(session: AsyncSession, *, tenant_id: uuid.UUID, kind: str, quantity: float = 1.0,
              unit: str = "count", user_id: uuid.UUID | None = None, task_id: uuid.UUID | None = None,
              agent_id: uuid.UUID | None = None, cost_usd: float = 0.0, metadata: dict[str, Any] | None = None
              ) -> None:
    """Stage a usage event in the caller's transaction."""
    session.add(UsageEvent(
        tenant_id=tenant_id, user_id=user_id, task_id=task_id, agent_id=agent_id, kind=kind, quantity=quantity,
        unit=unit, cost_micros=int(round(cost_usd * 1_000_000)), metadata_=metadata or {},
    ))


async def record_usage_once(session: AsyncSession, *, idempotency_key: str, tenant_id: uuid.UUID, kind: str,
                            quantity: float = 1.0, unit: str = "count", user_id: uuid.UUID | None = None,
                            task_id: uuid.UUID | None = None, agent_id: uuid.UUID | None = None,
                            cost_usd: float = 0.0, metadata: dict[str, Any] | None = None) -> None:
    """Idempotent metering (e.g. one ``tool_call`` per external action, even across retries)."""
    await session.execute(
        insert(UsageEvent).values(
            id=new_id(), tenant_id=tenant_id, user_id=user_id, task_id=task_id, agent_id=agent_id, kind=kind,
            quantity=quantity, unit=unit, cost_micros=int(round(cost_usd * 1_000_000)), metadata_=metadata or {},
            idempotency_key=idempotency_key,
        ).on_conflict_do_nothing(index_elements=["idempotency_key"]),
        execution_options={"skip_tenant_scope": True},
    )


async def record_model_usage(meta: CallMetadata, response: ModelResponse | None, error: str | None) -> None:
    """ModelRouter usage sink. Metering is eventually consistent and written in its own
    transaction so it never couples to (or blocks) the caller's transaction."""
    if meta.tenant_id is None:
        return
    from app.core.database import get_session_factory

    async with get_session_factory()() as session:
        session.info["system"] = True
        common = {"tenant_id": meta.tenant_id, "user_id": meta.user_id, "task_id": meta.task_id,
                  "agent_id": meta.agent_id}
        if response is None:
            add_usage(session, kind=UsageKind.MODEL_CALL, metadata={"purpose": meta.purpose, "error": error},
                      **common)
        else:
            usage = response.usage
            md = {"purpose": meta.purpose, "model": response.model, "provider": response.provider,
                  "latency_ms": round(response.latency_ms, 1), "priced": usage.priced}
            add_usage(session, kind=UsageKind.MODEL_CALL, cost_usd=usage.cost_usd, metadata=md, **common)
            add_usage(session, kind=UsageKind.MODEL_INPUT_TOKENS, unit="tokens",
                      quantity=float(usage.input_tokens or usage.input_token_estimate), metadata=md, **common)
            add_usage(session, kind=UsageKind.MODEL_OUTPUT_TOKENS, unit="tokens",
                      quantity=float(usage.output_tokens or usage.output_token_estimate), metadata=md, **common)
        await session.commit()


# --------------------------------------------------------------------------- aggregation
_AGGREGATE_SQL = text(
    """
    INSERT INTO usage_aggregates (id, tenant_id, user_id, agent_id, period, period_start, kind, quantity,
                                  cost_micros, updated_at)
    SELECT gen_random_uuid(), tenant_id, user_id, agent_id, :period,
           date_trunc(:trunc, occurred_at AT TIME ZONE 'UTC')::date AS period_start, kind,
           sum(quantity), sum(cost_micros), now()
    FROM usage_events
    WHERE occurred_at >= :since
    GROUP BY tenant_id, user_id, agent_id, period_start, kind
    ON CONFLICT (tenant_id, user_id, agent_id, period, period_start, kind)
    DO UPDATE SET quantity = EXCLUDED.quantity, cost_micros = EXCLUDED.cost_micros, updated_at = now()
    """
)


async def aggregate_usage(session: AsyncSession, now: datetime | None = None) -> None:
    """Recompute day aggregates for the last two days and month aggregates for the current
    and previous month (idempotent upserts)."""
    now = now or utcnow()
    day_since = datetime(now.year, now.month, now.day, tzinfo=UTC) - timedelta(days=1)
    month_start = date(now.year, now.month, 1)
    prev_month = date(now.year - 1, 12, 1) if now.month == 1 else date(now.year, now.month - 1, 1)
    await session.execute(_AGGREGATE_SQL, {"period": "day", "trunc": "day", "since": day_since})
    await session.execute(_AGGREGATE_SQL, {"period": "month", "trunc": "month",
                                           "since": datetime(prev_month.year, prev_month.month, 1, tzinfo=UTC)})
    await session.commit()
    logger.info("usage aggregated", extra={"month": str(month_start)})


# --------------------------------------------------------------------------- quotas
_quota_cache: dict[tuple[uuid.UUID, str], tuple[float, float]] = {}


async def month_usage(session: AsyncSession, tenant_id: uuid.UUID, kind: str) -> float:
    key = (tenant_id, kind)
    cached = _quota_cache.get(key)
    if cached and time.monotonic() - cached[0] < 30:
        return cached[1]
    now = utcnow()
    since = datetime(now.year, now.month, 1, tzinfo=UTC)
    total = (await session.execute(
        select(func.coalesce(func.sum(UsageEvent.quantity), 0.0)).where(
            UsageEvent.tenant_id == tenant_id, UsageEvent.kind == kind, UsageEvent.occurred_at >= since),
        execution_options={"skip_tenant_scope": True},
    )).scalar_one()
    _quota_cache[key] = (time.monotonic(), float(total))
    return float(total)


async def enforce_quota(session: AsyncSession, tenant_id: uuid.UUID, plan_name: str, kind: str,
                        amount: float = 1.0) -> None:
    plan = get_plan(plan_name)
    limit = plan.monthly_quotas.get(kind)
    if limit is None:
        return
    used = await month_usage(session, tenant_id, kind)
    if used + amount > limit:
        raise QuotaExceeded(details={"kind": kind, "limit": limit, "used": used, "plan": plan.name})
