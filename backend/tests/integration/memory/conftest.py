"""Fixtures for memory integration tests (PostgreSQL + pgvector)."""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.api.errors import install_exception_handlers
from app.core.database import get_session_factory
from app.core.middleware import RequestContextMiddleware
from app.model_gateway.providers.scripted import ScriptedProvider
from app.model_gateway.router import ModelRouter, set_model_router
from app.workers.jobs.registry import JobContext
from app.workers.queues.base import ClaimedJob


@pytest_asyncio.fixture
async def scripted_router() -> AsyncIterator[ModelRouter]:
    """Deterministic model router (hashed embeddings); installed as the process router for jobs."""
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


@pytest.fixture
def run_embed_job(scripted_router: ModelRouter) -> Callable[..., Any]:
    """Run the ``memory.embed`` handler exactly as a worker would."""
    from app.memory.jobs import embed_memory

    async def _run(tenant_id: uuid.UUID, memory_id: uuid.UUID) -> None:
        payload = {"tenant_id": str(tenant_id), "memory_id": str(memory_id)}
        job = ClaimedJob(id=uuid.uuid4(), queue="memory", job_type="memory.embed", payload=payload, attempts=1,
                         max_attempts=5, tenant_id=tenant_id)
        await embed_memory(JobContext(job=job, worker_id="test-worker", session_factory=get_session_factory()),
                           payload)

    return _run


@pytest_asyncio.fixture
async def memory_client() -> AsyncIterator[httpx.AsyncClient]:
    """A minimal app mounting only the memory router (the shared app does not include it yet)."""
    from app.memory.router import router as memory_router

    app = FastAPI()
    app.add_middleware(RequestContextMiddleware)
    install_exception_handlers(app)
    app.include_router(memory_router, prefix="/api/v1")
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as c:
        yield c
