"""SSE streams survive event-bus (Redis) failures: pub/sub is only a latency optimisation."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from app.tasks.router import _next_wakeup


async def _wakes() -> AsyncIterator[dict[str, Any]]:
    yield {"type": "__idle__"}
    yield {"type": "task.updated"}


async def _broken() -> AsyncIterator[dict[str, Any]]:
    raise ConnectionError("redis down")
    yield {}  # pragma: no cover


async def _quiet() -> AsyncIterator[dict[str, Any]]:
    while True:
        yield {"type": "__idle__"}


async def test_wakeup_on_published_event() -> None:
    assert await _next_wakeup(_wakes(), 1.0) is True


async def test_quiet_bus_times_out_and_stays_usable() -> None:
    assert await _next_wakeup(_quiet(), 0.05) is True


async def test_failed_or_closed_bus_switches_to_polling() -> None:
    assert await _next_wakeup(_broken(), 1.0) is False
    closed = _wakes()
    async for _ in closed:
        pass
    assert await _next_wakeup(closed, 1.0) is False  # exhausted subscription must not hot-loop
