"""
In-process sliding-window rate limiter.

Good for a single API instance. When running several instances behind a load
balancer, back this with a shared store (for example Redis) instead.
"""

from __future__ import annotations

import math
import threading
import time
from collections import deque
from collections.abc import Callable


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic, max_keys: int = 100_000):
        self._clock = clock
        self._max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str, limit: int, window_seconds: float) -> tuple[bool, int]:
        """Records a hit. Returns (allowed, retry_after_seconds)."""
        now = self._clock()
        with self._lock:
            hits = self._hits.get(key)
            if hits is None:
                if len(self._hits) >= self._max_keys:
                    self._evict(now, window_seconds)
                hits = self._hits[key] = deque()
            while hits and now - hits[0] >= window_seconds:
                hits.popleft()
            if len(hits) >= limit:
                retry_after = max(1, math.ceil(window_seconds - (now - hits[0])))
                return False, retry_after
            hits.append(now)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def _evict(self, now: float, window_seconds: float) -> None:
        stale = [
            key for key, hits in self._hits.items() if not hits or now - hits[-1] >= window_seconds
        ]
        for key in stale:
            del self._hits[key]
        if len(self._hits) >= self._max_keys:
            # Still full: drop the oldest half rather than grow without bound.
            for key in list(self._hits)[: self._max_keys // 2]:
                del self._hits[key]
