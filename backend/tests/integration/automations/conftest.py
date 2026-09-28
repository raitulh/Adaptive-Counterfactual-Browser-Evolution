"""Fixtures for automation integration tests: a dedicated FastAPI app (auth + automations
routers), user registration and direct-DB helpers."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from datetime import datetime, timedelta
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.automations.models import Automation
from app.common.time import utcnow
from app.core.database import get_session_factory
from app.organizations.models import Organization, OrganizationMember, Role


class ApiUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}


@pytest_asyncio.fixture(scope="session")
async def automations_app() -> FastAPI:
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router
    from app.automations.router import router as automations_router

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(automations_router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def api(automations_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=automations_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client


@pytest_asyncio.fixture
async def register_user(api: httpx.AsyncClient) -> Callable[..., Awaitable[ApiUser]]:
    async def _register(timezone: str = "UTC") -> ApiUser:
        email = f"auto-{uuid.uuid4().hex[:10]}@example.com"
        resp = await api.post("/api/v1/auth/register", json={
            "email": email, "password": "Str0ng!Passw0rd", "display_name": "Automation Owner",
            "timezone": timezone})
        assert resp.status_code == 201, resp.text
        return ApiUser(resp.json())

    return _register


@pytest.fixture
def sf() -> async_sessionmaker[AsyncSession]:
    return get_session_factory()


@pytest.fixture
def add_member(sf: async_sessionmaker[AsyncSession]) -> Callable[..., Awaitable[None]]:
    async def _add(tenant_id: uuid.UUID, user_id: uuid.UUID, role: str = "member") -> None:
        async with sf() as s:
            s.info["system"] = True
            role_row = (await s.execute(select(Role).where(Role.name == role, Role.tenant_id.is_(None))
                                        )).scalar_one()
            s.add(OrganizationMember(tenant_id=tenant_id, user_id=user_id, role_id=role_row.id))
            await s.commit()

    return _add


@pytest.fixture
def set_plan(sf: async_sessionmaker[AsyncSession]) -> Callable[..., Awaitable[None]]:
    async def _set(tenant_id: uuid.UUID, plan: str) -> None:
        async with sf() as s:
            s.info["system"] = True
            await s.execute(update(Organization).where(Organization.id == tenant_id).values(plan=plan))
            await s.commit()

    return _set


@pytest.fixture
def make_automation(sf: async_sessionmaker[AsyncSession]) -> Callable[..., Awaitable[Automation]]:
    """Insert an automation directly (lets tests control ``next_run_at``)."""

    async def _make(tenant_id: uuid.UUID, user_id: uuid.UUID, *, cron: str = "0 0 1 1 *",
                    next_run_at: datetime | None = None, goal: str = "Summarize my unread e-mails",
                    **fields: Any) -> Automation:
        async with sf() as s:
            s.info["system"] = True
            automation = Automation(
                tenant_id=tenant_id, user_id=user_id, name=fields.pop("name", "Digest"), cron_expression=cron,
                timezone=fields.pop("timezone", "UTC"), task_template={"goal": goal},
                next_run_at=next_run_at if next_run_at is not None else utcnow() - timedelta(minutes=1),
                **fields)
            s.add(automation)
            await s.commit()
            return automation

    return _make
