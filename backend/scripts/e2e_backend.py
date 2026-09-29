"""Start an ISOLATED simulated backend for the web app's end-to-end suite (web/tests/e2e).

    python scripts/e2e_backend.py            # from backend/, usually launched by Playwright

It reuses the PostgreSQL/Redis servers from backend/.env but never their data:
  * database `agentos_e2e` (E2E_DATABASE_NAME) is dropped, recreated and migrated on every start;
  * Redis logical database 15 (E2E_REDIS_DB) is flushed;
  * uploaded files go to .data/e2e-objects.
OAuth redirects and frontend URLs point at the e2e web server (E2E_WEB_URL, default
http://127.0.0.1:3100), and the simulated Google consent page is served by this process.

Then it runs scripts/simulated_backend.py (real API + worker, scripted model, simulated Google).
Refuses to run with APP_ENV=staging/production.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

BACKEND_DIR = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path) -> None:
    """Minimal .env reader (KEY=VALUE, # comments); never overrides the real environment."""
    if not path.is_file():
        return
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key.strip(), value)


def with_database(url: str, name: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{name}", parts.query, parts.fragment))


def with_redis_db(url: str, db: int) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{db}", parts.query, parts.fragment))


async def reset_database(admin_url: str, name: str) -> None:
    import asyncpg

    dsn = admin_url.replace("postgresql+asyncpg://", "postgresql://", 1)
    conn = await asyncpg.connect(with_database(dsn, "postgres"))
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{name}"')
    finally:
        await conn.close()


async def flush_redis(url: str) -> None:
    from redis.asyncio import Redis

    client = Redis.from_url(url)
    try:
        await client.flushdb()
    finally:
        await client.aclose()


def main() -> None:
    os.chdir(BACKEND_DIR)
    load_dotenv(BACKEND_DIR / ".env")
    if os.environ.get("APP_ENV", "development") in {"staging", "production"}:
        raise SystemExit("e2e_backend.py refuses to run with APP_ENV=staging/production")

    port = int(os.environ.get("E2E_API_PORT", "8100"))
    web = os.environ.get("E2E_WEB_URL", "http://127.0.0.1:3100").rstrip("/")
    db_name = os.environ.get("E2E_DATABASE_NAME", "agentos_e2e")
    if not db_name.replace("_", "").isalnum():
        raise SystemExit("E2E_DATABASE_NAME must be alphanumeric/underscore")
    base_db = os.environ.get("DATABASE_URL", "postgresql+asyncpg://agentos:agentos@localhost:5432/agentos")
    redis_url = with_redis_db(os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
                              int(os.environ.get("E2E_REDIS_DB", "15")))

    os.environ.update({
        "APP_ENV": "development",
        "DATABASE_URL": with_database(base_db, db_name),
        "REDIS_URL": redis_url,
        "MODEL_PROVIDER": "scripted",
        "LOG_LEVEL": os.environ.get("E2E_LOG_LEVEL", "WARNING"),
        "COOKIE_SECURE": "false",
        "CORS_ORIGINS": web,
        "PUBLIC_BASE_URL": web,
        "GOOGLE_REDIRECT_URI": f"{web}/api/v1/integrations/google/callback",
        "GOOGLE_LOGIN_REDIRECT_URI": f"{web}/callback/google",
        "FRONTEND_OAUTH_SUCCESS_URL": f"{web}/app/integrations?status=connected",
        "FRONTEND_OAUTH_ERROR_URL": f"{web}/app/integrations?status=error",
        "LOCAL_STORAGE_PATH": ".data/e2e-objects",
        # Every test registers users and creates tasks from one address; keep limits on but
        # high enough that the suite measures the product, not the limiter.
        "RATE_LIMIT_AUTH_PER_MINUTE": "1000",
        "RATE_LIMIT_TASK_CREATE_PER_MINUTE": "500",
        "RATE_LIMIT_IP_PER_MINUTE": "20000",
        "RATE_LIMIT_USER_PER_MINUTE": "5000",
        "RATE_LIMIT_TENANT_PER_MINUTE": "20000",
        "RATE_LIMIT_SEARCH_PER_MINUTE": "1000",
        "RATE_LIMIT_AUTOMATION_CREATE_PER_HOUR": "1000",
    })

    asyncio.run(reset_database(base_db, db_name))
    asyncio.run(flush_redis(redis_url))
    shutil.rmtree(BACKEND_DIR / ".data" / "e2e-objects", ignore_errors=True)

    python = sys.executable
    subprocess.run([python, "-m", "alembic", "upgrade", "head"], check=True)
    subprocess.run([python, "-m", "app.cli", "sync-tools"], check=True, stdout=subprocess.DEVNULL)

    os.execv(python, [python, "scripts/simulated_backend.py", "--port", str(port),
                      "--latency-ms", os.environ.get("E2E_LATENCY_MS", "120"),
                      "--public-url", f"http://127.0.0.1:{port}"])


if __name__ == "__main__":
    main()
