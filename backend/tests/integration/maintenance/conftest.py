"""Fixtures for maintenance-job integration tests."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.database import get_engine, get_session_factory

# The production migration installs this trigger; create_all does not, so tests add it.
AUDIT_TRIGGER_SQL = (
    """
    CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
        IF current_setting('agentos.audit_retention', true) = 'on' AND TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RAISE EXCEPTION 'audit_logs is append-only';
    END $$
    """,
    "DROP TRIGGER IF EXISTS audit_logs_append_only ON audit_logs",
    """
    CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()
    """,
)


class ApiUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])


@pytest_asyncio.fixture(scope="session")
async def audit_append_only() -> None:
    async with get_engine().begin() as conn:
        for statement in AUDIT_TRIGGER_SQL:
            await conn.execute(text(statement))


@pytest_asyncio.fixture(scope="session")
async def maintenance_app() -> FastAPI:
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def api(maintenance_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=maintenance_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest_asyncio.fixture
async def register_user(api: httpx.AsyncClient) -> Callable[..., Awaitable[ApiUser]]:
    async def _register() -> ApiUser:
        email = f"maint-{uuid.uuid4().hex[:10]}@example.com"
        resp = await api.post("/api/v1/auth/register", json={
            "email": email, "password": "Str0ng!Passw0rd", "display_name": "Maintenance User", "timezone": "UTC"})
        assert resp.status_code == 201, resp.text
        return ApiUser(resp.json())

    return _register


@pytest.fixture
def sf() -> async_sessionmaker[AsyncSession]:
    return get_session_factory()
