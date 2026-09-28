"""SSE plumbing: pub/sub is only a latency optimisation, so streams must survive its quirks and failures."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from typing import Any

import pytest

from app.common.events import InMemoryEventBus
from app.tasks.router import BusReader, EventBusClosed, _next_wakeup


async def _wakes() -> AsyncIterator[dict[str, Any]]:
    yield {"type": "__idle__"}
    yield {"type": "task.updated"}


async def _broken() -> AsyncIterator[dict[str, Any]]:
    raise ConnectionError("redis down")
    yield {}  # pragma: no cover


async def test_wakeup_on_published_event() -> None:
    assert await _next_wakeup(BusReader(_wakes()), 1.0) is True


async def test_subscription_survives_wait_timeouts() -> None:
    """Regression: asyncio.wait_for cancelled the pending read on timeout, which finalized the
    subscription generator — every wake-up after the first quiet period was lost."""
    bus = InMemoryEventBus()
    reader = BusReader(bus.subscribe("chan"))
    try:
        assert await reader.next_message(0.05) is None  # quiet: times out
        assert await reader.next_message(0.05) is None  # still quiet, still subscribed
        await bus.publish("chan", {"type": "task.updated", "n": 1})
        message = await reader.next_message(2.0)
        assert message == {"type": "task.updated", "n": 1}
    finally:
        await reader.aclose()


async def test_failed_or_closed_bus_switches_to_polling() -> None:
    assert await _next_wakeup(BusReader(_broken()), 1.0) is False
    closed = _wakes()
    async for _ in closed:
        pass
    reader = BusReader(closed)
    with pytest.raises(EventBusClosed):
        await reader.next_message(1.0)
    assert await _next_wakeup(BusReader(closed), 1.0) is False  # exhausted subscription must not hot-loop


async def test_aclose_cancels_pending_read() -> None:
    bus = InMemoryEventBus()
    reader = BusReader(bus.subscribe("chan"))
    assert await reader.next_message(0.01) is None
    await asyncio.wait_for(reader.aclose(), timeout=2.0)
