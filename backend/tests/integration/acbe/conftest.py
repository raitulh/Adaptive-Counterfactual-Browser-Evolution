"""Fixtures for ACBE integration tests: a dedicated app (auth + acbe routers), users, and
helpers that create tasks / verified failures / candidates directly in the database."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from typing import Any

import httpx
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, select, update

from app.common.context import RequestContext
from app.common.models import WorkerHeartbeat
from app.common.time import utcnow
from app.core.database import system_session
from app.organizations.models import OrganizationMember, Role
from app.organizations.rbac import ROLE_PERMISSIONS
from app.users.models import User


class AcbeUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def ctx(self, *, role: str = "owner", platform_admin: bool = False) -> RequestContext:
        return RequestContext(user_id=self.user_id, tenant_id=self.tenant_id, role=role,
                              permissions=frozenset(ROLE_PERMISSIONS[role]), is_platform_admin=platform_admin)


@pytest_asyncio.fixture(scope="session")
async def acbe_app() -> FastAPI:
    from app.acbe.router import router as acbe_router
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(acbe_router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def acbe_client(acbe_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=acbe_app), base_url="http://testserver") as c:
        yield c


@pytest_asyncio.fixture
async def acbe_user(acbe_client: httpx.AsyncClient) -> Any:
    async def _make(*, role: str = "owner", platform_admin: bool = False) -> AcbeUser:
        resp = await acbe_client.post("/api/v1/auth/register", json={
            "email": f"acbe-{uuid.uuid4().hex[:10]}@example.com", "password": "Str0ng!Passw0rd",
            "display_name": "ACBE", "timezone": "UTC"})
        assert resp.status_code == 201, resp.text
        user = AcbeUser(resp.json())
        async with system_session() as s:
            if role != "owner":
                role_id = (await s.execute(select(Role.id).where(Role.name == role, Role.tenant_id.is_(None)))
                           ).scalar_one()
                await s.execute(update(OrganizationMember).where(OrganizationMember.user_id == user.user_id)
                                .values(role_id=role_id))
            if platform_admin:
                await s.execute(update(User).where(User.id == user.user_id).values(is_platform_admin=True))
            await s.commit()
        return user

    return _make


@pytest_asyncio.fixture
async def dedicated_evaluation_worker() -> AsyncIterator[str]:
    worker_id = f"acbe-worker-{uuid.uuid4().hex[:8]}"
    async with system_session() as s:
        s.add(WorkerHeartbeat(worker_id=worker_id, kind="worker", queues=["evaluation"], started_at=utcnow(),
                              last_seen_at=utcnow(), jobs_in_flight=0, jobs_processed=0))
        await s.commit()
    yield worker_id
    async with system_session() as s:
        await s.execute(delete(WorkerHeartbeat).where(WorkerHeartbeat.worker_id == worker_id))
        await s.commit()


@pytest_asyncio.fixture(autouse=True)
async def _drop_pending_evaluation_jobs() -> AsyncIterator[None]:
    """Evaluation jobs only run on a dedicated evaluation worker; never leave them queued for other tests."""
    from app.workers.queues.models import Job

    yield
    async with system_session() as s:
        await s.execute(delete(Job).where(Job.job_type.in_(["evaluation.run", "acbe.run_experiment"]),
                                          Job.status == "pending"))
        await s.commit()
