"""Redis client factory.

Redis holds *transient* shared state only: rate-limit counters, short locks,
OAuth state, stream wake-ups and caches. Nothing in Redis is the sole copy of
durable task, approval or permission state (PostgreSQL is authoritative).
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator

from redis.asyncio import Redis

from app.core.config import get_settings

_client: Redis | None = None


def get_redis() -> Redis:
    global _client
    if _client is None:
        settings = get_settings()
        _client = Redis.from_url(
            settings.redis_url,
            socket_timeout=settings.redis_socket_timeout_seconds,
            socket_connect_timeout=settings.redis_connect_timeout_seconds,
            health_check_interval=30,
            decode_responses=True,
        )
    return _client


def set_redis(client: Redis | None) -> None:
    """Override the process client (tests)."""
    global _client
    _client = client


async def close_redis() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
    _client = None


async def check_redis() -> bool:
    return bool(await get_redis().ping())


_RELEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
"""


class LockNotAcquired(RuntimeError):
    pass


@contextlib.asynccontextmanager
async def short_lock(key: str, ttl_seconds: int = 30, *, redis: Redis | None = None) -> AsyncIterator[None]:
    """A short-lived, owner-checked distributed lock (SET NX PX + compare-and-delete).

    Only for de-duplicating work (e.g. concurrent OAuth token refresh). Never
    used as the correctness mechanism for durable state — that is row-level
    locking and optimistic versioning in PostgreSQL.
    """
    client = redis or get_redis()
    token = uuid.uuid4().hex
    acquired = await client.set(f"lock:{key}", token, nx=True, px=ttl_seconds * 1000)
    if not acquired:
        raise LockNotAcquired(key)
    try:
        yield
    finally:
        await client.eval(_RELEASE_SCRIPT, 1, f"lock:{key}", token)  # type: ignore[misc]
