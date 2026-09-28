"""Shared fixtures for files/search integration tests: a dedicated app (auth + files + search
routers), isolated local object storage, a controllable malware scanner, a deterministic model
router and helpers that run the ``file.process`` job exactly as a worker would.

Imported by ``tests/integration/files/conftest.py`` and ``tests/integration/search/conftest.py``."""

from __future__ import annotations

import sys
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

_SAMPLES = str(Path(__file__).resolve().parents[2] / "unit" / "files")
if _SAMPLES not in sys.path:
    sys.path.insert(0, _SAMPLES)

from app.common.context import RequestContext  # noqa: E402
from app.core.database import get_session_factory  # noqa: E402
from app.files.scanning import ScanResult, ScanStatus, set_scanner  # noqa: E402
from app.files.storage import LocalFilesystemStorage, set_storage  # noqa: E402
from app.model_gateway.providers.scripted import ScriptedProvider  # noqa: E402
from app.model_gateway.router import ModelRouter, set_model_router  # noqa: E402
from app.organizations.rbac import ROLE_PERMISSIONS  # noqa: E402
from app.organizations.schemas import OrganizationPolicy  # noqa: E402
from app.tools.base import ToolContext  # noqa: E402
from app.tools.services import ToolServices  # noqa: E402
from app.workers.jobs.registry import JobContext  # noqa: E402
from app.workers.queues.base import ClaimedJob  # noqa: E402


class ApiUser:
    def __init__(self, data: dict[str, Any]) -> None:
        self.access_token: str = data["access_token"]
        self.user_id = uuid.UUID(data["user_id"])
        self.tenant_id = uuid.UUID(data["tenant_id"])

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.access_token}"}

    def ctx(self) -> RequestContext:
        return RequestContext(user_id=self.user_id, tenant_id=self.tenant_id, role="owner",
                              permissions=frozenset(ROLE_PERMISSIONS["owner"]))


class ControlledScanner:
    """Clean by default; tests flip ``result`` to simulate detections or scanner outages."""

    name = "fake"

    def __init__(self) -> None:
        self.result = ScanResult(status=ScanStatus.CLEAN, scanner=self.name)
        self.scanned: list[bytes] = []

    async def scan(self, data: bytes) -> ScanResult:
        self.scanned.append(data)
        return self.result


@pytest_asyncio.fixture(scope="session")
async def files_app() -> FastAPI:
    from app.api.errors import install_exception_handlers
    from app.auth.router import router as auth_router
    from app.files.router import router as files_router
    from app.search.router import router as search_router

    app = FastAPI()
    install_exception_handlers(app)
    for router in (auth_router, files_router, search_router):
        app.include_router(router, prefix="/api/v1")
    return app


@pytest_asyncio.fixture
async def api(files_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=files_app),
                                 base_url="http://testserver") as client:
        yield client


@pytest.fixture
def register(api: httpx.AsyncClient) -> Callable[[], Awaitable[ApiUser]]:
    async def _register() -> ApiUser:
        resp = await api.post("/api/v1/auth/register", json={
            "email": f"files-{uuid.uuid4().hex[:10]}@example.com", "password": "Str0ng!Passw0rd",
            "display_name": "Files User", "timezone": "UTC"})
        assert resp.status_code == 201, resp.text
        return ApiUser(resp.json())

    return _register


@pytest.fixture
def storage(tmp_path: Path) -> Iterator[LocalFilesystemStorage]:
    store = LocalFilesystemStorage(tmp_path / "objects")
    set_storage(store)
    yield store
    set_storage(None)


@pytest.fixture
def scanner() -> Iterator[ControlledScanner]:
    fake = ControlledScanner()
    set_scanner(fake)
    yield fake
    set_scanner(None)


@pytest.fixture
def model_router() -> Iterator[ModelRouter]:
    router = ModelRouter(ScriptedProvider(), usage_sink=None)
    set_model_router(router)
    yield router
    set_model_router(None)


@pytest.fixture
def run_process_job(model_router: ModelRouter) -> Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]:
    from app.files.jobs import process_file_job

    async def _run(tenant_id: uuid.UUID, file_id: uuid.UUID) -> None:
        payload = {"tenant_id": str(tenant_id), "file_id": str(file_id)}
        job = ClaimedJob(id=uuid.uuid4(), queue="files", job_type="file.process", payload=payload, attempts=1,
                         max_attempts=5, tenant_id=tenant_id)
        await process_file_job(JobContext(job=job, worker_id="test-worker", session_factory=get_session_factory()),
                               payload)

    return _run


@pytest.fixture
def make_tctx(storage: LocalFilesystemStorage, model_router: ModelRouter) -> Callable[..., ToolContext]:
    def _make(user: ApiUser, *, idempotency_key: str | None = None, search: Any = None,
              extras: dict[str, Any] | None = None) -> ToolContext:
        services = ToolServices(session_factory=get_session_factory(), vault=None,  # type: ignore[arg-type]
                                model=model_router, google_http=None, storage=storage,  # type: ignore[arg-type]
                                search=search, extras=extras or {})
        return ToolContext(ctx=user.ctx(), task_id=uuid.uuid4(), step_id=uuid.uuid4(), step_key="step-1",
                           attempt_number=1, idempotency_key=idempotency_key or f"idem-{uuid.uuid4().hex}",
                           services=services, org_policy=OrganizationPolicy())

    return _make
