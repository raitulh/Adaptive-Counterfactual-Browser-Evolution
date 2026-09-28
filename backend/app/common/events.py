"""Internal event model and the EventBus abstraction.

Durable truth lives in PostgreSQL (``task_events``, ``outbox_events``). The
event bus only *fans out* notifications (e.g. to SSE streams and other
replicas); consumers must tolerate duplicates and gaps by re-reading durable
state. The initial backend is Redis pub/sub; Kafka/PubSub implementations can
replace it without changing domain code, which only calls ``publish`` or
writes to the outbox.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Any, Protocol

from app.common.enums import StrEnum

logger = logging.getLogger(__name__)


class EventType(StrEnum):
    TASK_CREATED = "TASK_CREATED"
    TASK_STATE_CHANGED = "TASK_STATE_CHANGED"
    PLANNING_STARTED = "PLANNING_STARTED"
    PLAN_CREATED = "PLAN_CREATED"
    PLAN_REJECTED = "PLAN_REJECTED"
    PLAN_VALIDATED = "PLAN_VALIDATED"
    STEP_STARTED = "STEP_STARTED"
    STEP_COMPLETED = "STEP_COMPLETED"
    STEP_FAILED = "STEP_FAILED"
    STEP_SKIPPED = "STEP_SKIPPED"
    TOOL_CALL_STARTED = "TOOL_CALL_STARTED"
    TOOL_CALL_FINISHED = "TOOL_CALL_FINISHED"
    APPROVAL_REQUIRED = "APPROVAL_REQUIRED"
    APPROVAL_GRANTED = "APPROVAL_GRANTED"
    APPROVAL_REJECTED = "APPROVAL_REJECTED"
    APPROVAL_EXPIRED = "APPROVAL_EXPIRED"
    INPUT_REQUIRED = "INPUT_REQUIRED"
    INPUT_RECEIVED = "INPUT_RECEIVED"
    RETRY_SCHEDULED = "RETRY_SCHEDULED"
    RECOVERY_STARTED = "RECOVERY_STARTED"
    RECOVERY_DECIDED = "RECOVERY_DECIDED"
    RECONCILIATION_REQUIRED = "RECONCILIATION_REQUIRED"
    RECONCILIATION_RESOLVED = "RECONCILIATION_RESOLVED"
    VERIFICATION_STARTED = "VERIFICATION_STARTED"
    VERIFICATION_PASSED = "VERIFICATION_PASSED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    CANCEL_REQUESTED = "CANCEL_REQUESTED"
    TASK_PAUSED = "TASK_PAUSED"
    TASK_RESUMED = "TASK_RESUMED"
    TASK_COMPLETED = "TASK_COMPLETED"
    TASK_FAILED = "TASK_FAILED"
    TASK_CANCELLED = "TASK_CANCELLED"
    BUDGET_EXCEEDED = "BUDGET_EXCEEDED"
    NOTIFICATION_CREATED = "NOTIFICATION_CREATED"


def task_channel(task_id: object) -> str:
    return f"agentos:task:{task_id}"


def user_channel(user_id: object) -> str:
    return f"agentos:user:{user_id}"


class EventBus(Protocol):
    async def publish(self, channel: str, message: dict[str, Any]) -> None: ...

    def subscribe(self, *channels: str) -> AsyncIterator[dict[str, Any]]: ...


class RedisEventBus:
    def __init__(self, redis: Any) -> None:
        self._redis = redis

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        await self._redis.publish(channel, json.dumps(message, default=str))

    async def subscribe(self, *channels: str) -> AsyncIterator[dict[str, Any]]:  # type: ignore[override]
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(*channels)
        try:
            while True:
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg is None:
                    yield {"type": "__idle__"}
                    continue
                try:
                    yield json.loads(msg["data"])
                except (TypeError, ValueError):
                    continue
        finally:
            with contextlib.suppress(Exception):
                await pubsub.unsubscribe(*channels)
                await pubsub.aclose()


class InMemoryEventBus:
    """Single-process bus for tests and tooling."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)
        self.published: list[tuple[str, dict[str, Any]]] = []

    async def publish(self, channel: str, message: dict[str, Any]) -> None:
        self.published.append((channel, message))
        for queue in list(self._subscribers.get(channel, [])):
            queue.put_nowait(message)

    async def subscribe(self, *channels: str) -> AsyncIterator[dict[str, Any]]:  # type: ignore[override]
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        for channel in channels:
            self._subscribers[channel].append(queue)
        try:
            while True:
                try:
                    yield await asyncio.wait_for(queue.get(), timeout=1.0)
                except TimeoutError:
                    yield {"type": "__idle__"}
        finally:
            for channel in channels:
                self._subscribers[channel].remove(queue)


_bus: EventBus | None = None


def get_event_bus() -> EventBus:
    global _bus
    if _bus is None:
        from app.core.redis import get_redis

        _bus = RedisEventBus(get_redis())
    return _bus


def set_event_bus(bus: EventBus | None) -> None:
    global _bus
    _bus = bus
