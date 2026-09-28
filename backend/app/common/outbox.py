"""Transactional outbox writer and relay."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.events import EventBus
from app.common.models import OutboxEvent
from app.common.time import utcnow

logger = logging.getLogger(__name__)


def add_outbox_event(session: AsyncSession, *, topic: str, event_type: str, payload: dict[str, Any],
                     tenant_id: uuid.UUID | None = None) -> None:
    """Stage an event in the caller's transaction. It is published only if the
    transaction commits, so state and events can never diverge."""
    session.add(OutboxEvent(topic=topic, event_type=event_type, payload=payload, tenant_id=tenant_id))


class OutboxRelay:
    def __init__(self, session_factory: Any, bus: EventBus, batch_size: int = 200) -> None:
        self._session_factory = session_factory
        self._bus = bus
        self._batch = batch_size

    async def run_once(self) -> int:
        async with self._session_factory() as session:
            session.info["system"] = True
            rows = (
                await session.execute(
                    select(OutboxEvent)
                    .where(OutboxEvent.published_at.is_(None))
                    .order_by(OutboxEvent.id)
                    .limit(self._batch)
                    .with_for_update(skip_locked=True)
                )
            ).scalars().all()
            if not rows:
                await session.rollback()
                return 0
            published: list[int] = []
            for row in rows:
                try:
                    await self._bus.publish(row.topic, {"type": row.event_type, **row.payload})
                    published.append(row.id)
                except Exception:  # bus outage: leave unpublished for the next pass
                    logger.warning("outbox publish failed", extra={"outbox_id": row.id})
                    break
            if published:
                await session.execute(
                    update(OutboxEvent).where(OutboxEvent.id.in_(published)).values(published_at=utcnow())
                )
            await session.commit()
            return len(published)
