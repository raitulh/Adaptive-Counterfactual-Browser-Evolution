"""Wait until the services AgentOS depends on accept connections.

Used by Docker Compose / Kubernetes before running migrations or starting a process:

    python scripts/wait_for_services.py                     # PostgreSQL + Redis, 60 s
    python scripts/wait_for_services.py --timeout 120
    python scripts/wait_for_services.py --services object-storage --ensure-bucket

Connection settings come from the same environment/.env as the application
(DATABASE_URL, REDIS_URL, OBJECT_STORAGE_*). Exit status: 0 when every requested
service answered, 1 on timeout, 2 on bad arguments. Credentials are never printed.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402

SERVICES = ("database", "redis", "object-storage")


def log(message: str) -> None:
    print(f"[wait-for-services] {message}", file=sys.stderr, flush=True)


async def probe_database(settings: Settings, timeout: float) -> None:
    # Same driver and URL semantics as the application (e.g. ?ssl=require is honoured).
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import NullPool

    engine = create_async_engine(settings.database_url, poolclass=NullPool, connect_args={"timeout": timeout})
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
    finally:
        await engine.dispose()


async def probe_redis(settings: Settings, timeout: float) -> None:
    from redis.asyncio import Redis

    client = Redis.from_url(settings.redis_url, socket_timeout=timeout, socket_connect_timeout=timeout)
    try:
        if not await client.ping():
            raise ConnectionError("redis did not answer PING")
    finally:
        await client.aclose()


def _s3_client(settings: Settings, timeout: float) -> Any:
    import boto3
    from botocore.config import Config

    kwargs: dict[str, Any] = {
        "region_name": settings.object_storage_region,
        "config": Config(connect_timeout=timeout, read_timeout=timeout, retries={"max_attempts": 1},
                         s3={"addressing_style": "path"}),
    }
    if settings.object_storage_endpoint:
        kwargs["endpoint_url"] = settings.object_storage_endpoint
    access = settings.object_storage_access_key.get_secret_value()
    secret = settings.object_storage_secret_key.get_secret_value()
    if access and secret:
        kwargs["aws_access_key_id"] = access
        kwargs["aws_secret_access_key"] = secret
    return boto3.client("s3", **kwargs)


def _check_bucket(settings: Settings, timeout: float, ensure: bool) -> None:
    from botocore.exceptions import ClientError

    client = _s3_client(settings, timeout)
    bucket = settings.object_storage_bucket
    try:
        client.head_bucket(Bucket=bucket)
        return
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code not in ("404", "NoSuchBucket", "NotFound") or not ensure:
            raise
    params: dict[str, Any] = {"Bucket": bucket}
    if settings.object_storage_region and settings.object_storage_region != "us-east-1":
        params["CreateBucketConfiguration"] = {"LocationConstraint": settings.object_storage_region}
    client.create_bucket(**params)
    log(f"created bucket '{bucket}'")


async def probe_object_storage(settings: Settings, timeout: float, *, ensure: bool = False) -> None:
    if settings.object_storage_backend != "s3":
        return  # local filesystem backend: nothing to wait for
    await asyncio.to_thread(_check_bucket, settings, timeout, ensure)


async def wait_for(name: str, probe: Callable[[], Awaitable[None]], deadline: float) -> bool:
    attempt = 0
    while True:
        attempt += 1
        try:
            await probe()
            log(f"{name}: ready")
            return True
        except Exception as exc:  # any failure means "not ready yet"
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                log(f"{name}: not ready before the timeout ({type(exc).__name__})")
                return False
            if attempt == 1 or attempt % 5 == 0:
                log(f"{name}: waiting ({type(exc).__name__}); {remaining:.0f}s left")
            await asyncio.sleep(min(2.0, max(0.2, remaining)))


async def run(services: list[str], timeout: float, ensure_bucket: bool) -> bool:
    settings = Settings()
    deadline = time.monotonic() + timeout
    per_attempt = min(5.0, max(1.0, timeout / 4))
    probes: dict[str, Callable[[], Awaitable[None]]] = {
        "database": lambda: probe_database(settings, per_attempt),
        "redis": lambda: probe_redis(settings, per_attempt),
        "object-storage": lambda: probe_object_storage(settings, per_attempt, ensure=ensure_bucket),
    }
    results = await asyncio.gather(*(wait_for(name, probes[name], deadline) for name in services))
    return all(results)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Wait for AgentOS dependencies to accept connections")
    parser.add_argument("--services", default="database,redis",
                        help=f"comma separated subset of: {', '.join(SERVICES)} (default: database,redis)")
    parser.add_argument("--timeout", type=float, default=60.0, help="seconds to wait in total (default: 60)")
    parser.add_argument("--ensure-bucket", action="store_true",
                        help="create OBJECT_STORAGE_BUCKET if it does not exist (s3 backend only)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    services = [s.strip() for s in args.services.split(",") if s.strip()]
    unknown = [s for s in services if s not in SERVICES]
    if unknown or not services:
        log(f"unknown service(s): {', '.join(unknown) or '(none given)'}; choose from {', '.join(SERVICES)}")
        return 2
    ok = asyncio.run(run(services, max(1.0, args.timeout), args.ensure_bucket))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
