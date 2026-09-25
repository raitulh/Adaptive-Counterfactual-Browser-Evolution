from __future__ import annotations

from datetime import UTC, datetime


class Clock:
    """Source of "now". Injected so tests can control time."""

    def now(self) -> datetime:
        return datetime.now(UTC)
