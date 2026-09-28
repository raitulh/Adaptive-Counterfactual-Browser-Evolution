"""Shared test fixtures.

Integration tests run against real PostgreSQL (+pgvector) and Redis. Configure with
TEST_DATABASE_URL / TEST_REDIS_URL (defaults match docker-compose / local dev). The
schema is built by running the Alembic migrations (TEST_SCHEMA_MODE=alembic, default),
which also proves the migrations work.
"""

from __future__ import annotations

import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

from cryptography.fernet import Fernet

os.environ.setdefault("APP_ENV", "test")
os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://agentos:agentos@localhost:5432/agentos_test")
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("JWT_SECRET", "test-secret-" + "x" * 40)
os.environ.setdefault("MODEL_PROVIDER", "scripted")
os.environ.setdefault("RATE_LIMIT_AUTH_PER_MINUTE", "100000")
os.environ.setdefault("RATE_LIMIT_IP_PER_MINUTE", "100000")
os.environ.setdefault("RATE_LIMIT_USER_PER_MINUTE", "100000")
os.environ.setdefault("RATE_LIMIT_TENANT_PER_MINUTE", "100000")
os.environ.setdefault("RATE_LIMIT_TASK_CREATE_PER_MINUTE", "100000")
os.environ.setdefault("LOG_JSON", "false")
os.environ.setdefault("LOG_LEVEL", "WARNING")
os.environ.setdefault("GOOGLE_CLIENT_ID", "test-client-id.apps.googleusercontent.com")
os.environ.setdefault("GOOGLE_CLIENT_SECRET", "test-client-secret")
os.environ.setdefault("LOCAL_STORAGE_PATH", "/tmp/agentos-test-objects")

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.core.config import get_settings  # noqa: E402

get_settings.cache_clear()


def _schema_mode() -> str:
    return os.environ.get("TEST_SCHEMA_MODE", "alembic")


async def _build_schema() -> None:
    from app.core.database import Base, get_engine
    from app.db_models import import_all_models

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    if _schema_mode() == "alembic":
        import asyncio

        from alembic import command
        from alembic.config import Config

        cfg = Config(os.path.join(os.path.dirname(__file__), "..", "alembic.ini"))
        cfg.set_main_option("script_location", os.path.join(os.path.dirname(__file__), "..", "migrations"))
        await asyncio.to_thread(command.upgrade, cfg, "head")
    else:
        import_all_models()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            from app.organizations.rbac import PERMISSION_DESCRIPTIONS, ROLE_PERMISSIONS

            for code, desc in PERMISSION_DESCRIPTIONS.items():
                await conn.execute(text("INSERT INTO permissions (id, code, description) VALUES "
                                        "(gen_random_uuid(), :c, :d)"), {"c": code, "d": desc})
            for role, perms in ROLE_PERMISSIONS.items():
                rid = uuid.uuid4()
                await conn.execute(text("INSERT INTO roles (id, name, is_system, created_at, updated_at) VALUES "
                                        "(:id, :n, true, now(), now())"), {"id": rid, "n": role})
                for p in perms:
                    await conn.execute(text("INSERT INTO role_permissions (role_id, permission_id) "
                                            "SELECT :r, id FROM permissions WHERE code = :p"), {"r": rid, "p": p})


@pytest_asyncio.fixture(scope="session", autouse=True)
async def _database() -> AsyncIterator[None]:
    from app.core.database import dispose_engine
    from app.core.redis import close_redis, get_redis

    try:
        await _build_schema()
    except OSError as exc:  # pragma: no cover - environment without services
        pytest.skip(f"PostgreSQL unavailable: {exc}", allow_module_level=True)
    await get_redis().flushdb()
    yield
    await close_redis()
    await dispose_engine()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


@pytest_asyncio.fixture
async def db_session() -> AsyncIterator[Any]:
    from app.core.database import get_session_factory

    async with get_session_factory()() as session:
        session.info["system"] = True
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="session")
async def app() -> Any:
    from app.main import create_app

    return create_app()


@pytest_asyncio.fixture
async def client(app: Any) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


class UserHandle:
    def __init__(self, data: dict[str, Any], email: str, password: str) -> None:
        self.data = data
        self.email = email
        self.password = password
        self.access_token: str = data["access_token"]
        self.refresh_token: str | None = data.get("refresh_token")
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}


@pytest_asyncio.fixture
async def make_user(client: httpx.AsyncClient) -> Any:
    async def _make(email: str | None = None, password: str = "Str0ng!Passw0rd", timezone: str = "UTC",
                    display_name: str = "Test User") -> UserHandle:
        email = email or f"user-{uuid.uuid4().hex[:10]}@example.com"
        resp = await client.post("/api/v1/auth/register", json={
            "email": email, "password": password, "display_name": display_name, "timezone": timezone})
        assert resp.status_code == 201, resp.text
        return UserHandle(resp.json(), email, password)

    return _make
