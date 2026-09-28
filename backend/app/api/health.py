"""Liveness, readiness and dependency health."""

from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.core.config import get_settings
from app.core.database import check_database, get_engine
from app.core.redis import check_redis

router = APIRouter(tags=["health"])


async def _probe(coro: Any, timeout: float = 2.0) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await asyncio.wait_for(coro, timeout=timeout)
        return {"status": "ok", "latency_ms": round((time.perf_counter() - started) * 1000, 2)}
    except Exception as exc:
        return {"status": "error", "error": type(exc).__name__}


async def _queue_probe() -> None:
    async with get_engine().connect() as conn:
        await conn.execute(text("SELECT 1 FROM jobs LIMIT 1"))


async def _migrations_probe() -> None:
    async with get_engine().connect() as conn:
        version = (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalar_one_or_none()
        if version is None:
            raise RuntimeError("database not migrated")


def _provider_config() -> dict[str, Any]:
    s = get_settings()
    return {
        "model_provider": {"provider": s.model_provider,
                           "configured": bool(s.gemini_api_key.get_secret_value()) or s.model_provider != "gemini"},
        "google_oauth": {"configured": bool(s.google_client_id and s.google_client_secret.get_secret_value())},
        "search": {"provider": s.search_provider,
                   "configured": s.search_provider != "none" and bool(s.search_api_key.get_secret_value())},
        "object_storage": {"backend": s.object_storage_backend},
        "email_notifications": {"configured": bool(s.smtp_host)},
    }


@router.get("/live", summary="Liveness: the process is running")
async def live() -> dict[str, str]:
    return {"status": "alive"}


@router.get("/ready", summary="Readiness: critical dependencies reachable (503 otherwise)")
async def ready(response: Response) -> dict[str, Any]:
    db, redis, queue, migrations = await asyncio.gather(
        _probe(check_database()), _probe(check_redis()), _probe(_queue_probe()), _probe(_migrations_probe())
    )
    checks = {"database": db, "redis": redis, "queue": queue, "migrations": migrations}
    critical = ["database", "queue", "migrations"]
    if get_settings().readiness_requires_redis:
        critical.append("redis")
    ok = all(checks[name]["status"] == "ok" for name in critical)
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    degraded = sorted(name for name, c in checks.items() if c["status"] != "ok" and name not in critical)
    body: dict[str, Any] = {"status": "ready" if ok else "not_ready", "checks": checks}
    if degraded:
        body["degraded"] = degraded
    return body


@router.get("/health", summary="Detailed health: dependencies and provider configuration")
async def health(response: Response) -> dict[str, Any]:
    settings = get_settings()
    db, redis, queue = await asyncio.gather(_probe(check_database()), _probe(check_redis()), _probe(_queue_probe()))
    checks = {"database": db, "redis": redis, "queue": queue}
    degraded = any(c["status"] != "ok" for c in checks.values())
    if degraded:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "degraded" if degraded else "ok",
        "app": settings.app_name,
        "version": settings.app_version,
        "environment": settings.app_env.value,
        "region": settings.app_region,
        "checks": checks,
        "providers": _provider_config(),
    }
