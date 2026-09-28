"""Redis-backed rate limiting (sliding-window log approximated by a fixed-window
counter pair, computed atomically in Lua).

Scopes: ip, user, tenant, route, tool, model/provider, auth. Each check is a
single round trip. When Redis is unavailable the limiter fails open (or closed
when ``fail_open=False``) and records a metric so the outage is visible.
"""

from __future__ import annotations

import logging
import math
import time
from dataclasses import dataclass

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core import metrics
from app.core.config import get_settings
from app.core.exceptions import RateLimited, ServiceUnavailable

logger = logging.getLogger(__name__)

# Sliding window using the previous and current fixed windows, weighted by overlap.
_LUA = """
local cur_key = KEYS[1]
local prev_key = KEYS[2]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local elapsed = now % window
local prev = tonumber(redis.call('GET', prev_key) or '0')
local cur = tonumber(redis.call('GET', cur_key) or '0')
local weighted = prev * ((window - elapsed) / window) + cur
if weighted + cost > limit then
  return {0, math.floor(weighted), window - elapsed}
end
cur = redis.call('INCRBY', cur_key, cost)
redis.call('EXPIRE', cur_key, window * 2)
return {1, math.floor(weighted + cost), window - elapsed}
"""


@dataclass(frozen=True, slots=True)
class RateLimitResult:
    allowed: bool
    limit: int
    remaining: int
    reset_seconds: int


class RateLimiter:
    def __init__(self, redis: Redis, *, enabled: bool = True, fail_open: bool = True) -> None:
        self._redis = redis
        self._enabled = enabled
        self._fail_open = fail_open
        self._script = redis.register_script(_LUA)

    async def hit(self, scope: str, identifier: str, limit: int, window_seconds: int = 60, cost: int = 1,
                  *, fail_open: bool | None = None) -> RateLimitResult:
        if not self._enabled or limit <= 0:
            return RateLimitResult(True, limit, limit, 0)
        now = int(time.time())
        bucket = now // window_seconds
        cur_key = f"rl:{scope}:{identifier}:{bucket}"
        prev_key = f"rl:{scope}:{identifier}:{bucket - 1}"
        try:
            allowed, used, reset = await self._script(keys=[cur_key, prev_key],
                                                      args=[limit, window_seconds, now, cost])
        except (RedisError, OSError) as exc:
            open_ = self._fail_open if fail_open is None else fail_open
            metrics.rate_limited_total.labels(f"{scope}:redis_error").inc()
            logger.warning("rate limiter unavailable", extra={"scope": scope, "fail_open": open_})
            if open_:
                return RateLimitResult(True, limit, limit, 0)
            raise ServiceUnavailable("Rate limiting backend unavailable") from exc
        remaining = max(0, limit - int(used))
        return RateLimitResult(bool(allowed), limit, remaining, math.ceil(float(reset)))

    async def enforce(self, scope: str, identifier: str, limit: int, window_seconds: int = 60, cost: int = 1,
                      *, fail_open: bool | None = None) -> RateLimitResult:
        result = await self.hit(scope, identifier, limit, window_seconds, cost, fail_open=fail_open)
        if not result.allowed:
            metrics.rate_limited_total.labels(scope).inc()
            raise RateLimited(retry_after=max(1, result.reset_seconds), limit=limit,
                              details={"scope": scope})
        return result


_limiter: RateLimiter | None = None


def get_rate_limiter() -> RateLimiter:
    global _limiter
    if _limiter is None:
        from app.core.redis import get_redis

        settings = get_settings()
        _limiter = RateLimiter(get_redis(), enabled=settings.rate_limit_enabled,
                               fail_open=settings.rate_limit_fail_open)
    return _limiter


def set_rate_limiter(limiter: RateLimiter | None) -> None:
    global _limiter
    _limiter = limiter
