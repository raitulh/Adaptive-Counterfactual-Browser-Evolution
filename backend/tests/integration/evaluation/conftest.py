"""Fixtures for evaluation integration tests.

The evaluation/ACBE routers are not mounted in the shared application yet, so these tests
build a dedicated app (error handlers + auth + evaluation + acbe routers).
"""

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


class ApiUser:
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
async def eval_app() -> FastAPI:
    from app.acbe.router import router as acbe_router
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router
    from app.evaluation.router import experiments_router
    from app.evaluation.router import router as evaluation_router

    app = FastAPI()
    install_exception_handlers(app)
    for r in (auth_router, evaluation_router, experiments_router, acbe_router):
        app.include_router(r, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def eval_client(eval_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=eval_app), base_url="http://testserver") as c:
        yield c


@pytest_asyncio.fixture
async def api_user(eval_client: httpx.AsyncClient) -> Any:
    async def _make(*, role: str = "owner", platform_admin: bool = False) -> ApiUser:
        resp = await eval_client.post("/api/v1/auth/register", json={
            "email": f"u-{uuid.uuid4().hex[:10]}@example.com", "password": "Str0ng!Passw0rd",
            "display_name": "Evaluator", "timezone": "UTC"})
        assert resp.status_code == 201, resp.text
        user = ApiUser(resp.json())
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
async def dedicated_worker() -> AsyncIterator[str]:
    """A worker id registered (heartbeat) as serving only the evaluation queue."""
    worker_id = f"eval-worker-{uuid.uuid4().hex[:8]}"
    async with system_session() as s:
        s.add(WorkerHeartbeat(worker_id=worker_id, kind="worker", queues=["evaluation"], started_at=utcnow(),
                              last_seen_at=utcnow(), jobs_in_flight=0, jobs_processed=0))
        await s.commit()
    yield worker_id
    async with system_session() as s:
        await s.execute(delete(WorkerHeartbeat).where(WorkerHeartbeat.worker_id == worker_id))
        await s.commit()
