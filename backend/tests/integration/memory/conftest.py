"""Fixtures for memory integration tests (PostgreSQL + pgvector + Redis).

The memory router is not mounted in the shared application yet, so these tests build a dedicated
app (error handlers + auth + memory routers). ``make_user`` is overridden here to register through
that app, which keeps these tests independent of unrelated modules wired into ``app.main``.
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator, Callable
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.common.context import RequestContext
from app.core.database import get_session_factory
from app.model_gateway.providers.scripted import ScriptedProvider
from app.model_gateway.router import ModelRouter, set_model_router
from app.organizations.rbac import ROLE_PERMISSIONS
from app.organizations.schemas import OrganizationPolicy
from app.tools.base import ToolContext
from app.workers.jobs.registry import JobContext
from app.workers.queues.base import ClaimedJob


class MemoryUser:
    def __init__(self, data: dict[str, Any], email: str) -> None:
        self.email = email
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def ctx(self) -> RequestContext:
        return RequestContext(user_id=self.user_id, tenant_id=self.tenant_id, role="owner",
                              permissions=frozenset(ROLE_PERMISSIONS["owner"]))


@pytest_asyncio.fixture(scope="session")
async def memory_app() -> FastAPI:
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router
    from app.memory.router import router as memory_router

    app = FastAPI()
    install_exception_handlers(app)
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(memory_router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def memory_client(memory_app: FastAPI, scripted_router: ModelRouter) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=memory_app), base_url="http://testserver") as c:
        yield c


@pytest_asyncio.fixture
async def make_user(memory_app: FastAPI) -> AsyncIterator[Callable[..., Any]]:
    """Register a fresh user (and organization) through ``/api/v1/auth/register``."""
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=memory_app), base_url="http://testserver") as c:
        async def _make(email: str | None = None) -> MemoryUser:
            email = email or f"mem-{uuid.uuid4().hex[:10]}@example.com"
            resp = await c.post("/api/v1/auth/register", json={
                "email": email, "password": "Str0ng!Passw0rd", "display_name": "Memory User", "timezone": "UTC"})
            assert resp.status_code == 201, resp.text
            return MemoryUser(resp.json(), email)

        yield _make


@pytest_asyncio.fixture
async def scripted_router() -> AsyncIterator[ModelRouter]:
    """Deterministic model router (hashed embeddings); installed as the process router for jobs/API."""
    router = ModelRouter(ScriptedProvider(), usage_sink=None)
    set_model_router(router)
    yield router
    set_model_router(None)


@pytest.fixture
def tenant_session() -> Callable[[uuid.UUID], Any]:
    @contextlib.asynccontextmanager
    async def _open(tenant_id: uuid.UUID) -> AsyncIterator[Any]:
        async with get_session_factory()() as session:
            session.info["tenant_id"] = tenant_id
            yield session

    return _open


def job_context(job_type: str, payload: dict[str, Any], tenant_id: uuid.UUID | None, *, attempt: int = 1
                ) -> JobContext:
    job = ClaimedJob(id=uuid.uuid4(), queue="memory", job_type=job_type, payload=payload, attempts=attempt,
                     max_attempts=5, tenant_id=tenant_id)
    return JobContext(job=job, worker_id="test-worker", session_factory=get_session_factory())


@pytest.fixture
def make_job_context() -> Callable[..., JobContext]:
    return job_context


@pytest.fixture
def run_embed_job(scripted_router: ModelRouter) -> Callable[..., Any]:
    """Run the ``memory.embed`` handler exactly as a worker would."""
    from app.memory.jobs import embed_memory

    async def _run(tenant_id: uuid.UUID, memory_id: uuid.UUID) -> None:
        payload = {"tenant_id": str(tenant_id), "memory_id": str(memory_id)}
        await embed_memory(job_context("memory.embed", payload, tenant_id), payload)

    return _run


@pytest.fixture
def make_tool_context(scripted_router: ModelRouter) -> Callable[..., ToolContext]:
    """A ToolContext whose services expose only what memory tools use (session factory + model router)."""

    def _make(user: MemoryUser, task_id: uuid.UUID | None = None, *, model: ModelRouter | None = None
              ) -> ToolContext:
        services: Any = SimpleNamespace(session_factory=get_session_factory(), model=model or scripted_router)
        return ToolContext(ctx=user.ctx(), task_id=task_id or uuid.uuid4(), step_id=uuid.uuid4(), step_key="s1",
                           attempt_number=1, idempotency_key=f"idem-{uuid.uuid4().hex}", services=services,
                           org_policy=OrganizationPolicy())

    return _make
