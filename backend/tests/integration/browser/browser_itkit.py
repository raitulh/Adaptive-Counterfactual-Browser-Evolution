"""Helpers for browser integration tests (imported by the conftest and the tests)."""

from __future__ import annotations

import sys
import uuid
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

_UNIT = str(Path(__file__).resolve().parents[2] / "unit" / "browser")
if _UNIT not in sys.path:
    sys.path.insert(0, _UNIT)

from browser_testkit import FakeStorage, executor_settings  # noqa: E402

from app.browser.schemas import BrowserRunRequest, BrowserRunResult  # noqa: E402
from app.common.context import RequestContext  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.core.database import get_session_factory  # noqa: E402
from app.organizations.schemas import OrganizationPolicy  # noqa: E402
from app.tools.base import ToolContext  # noqa: E402
from app.workers.jobs.registry import JobContext  # noqa: E402
from app.workers.queues.base import ClaimedJob  # noqa: E402


@dataclass(slots=True)
class World:
    tenant_id: uuid.UUID
    user_id: uuid.UUID
    task_id: uuid.UUID


def tool_context(world: World, step: Any, *, settings: Settings | None = None, attempt: int = 1,
                 org_policy: OrganizationPolicy | None = None, strategy: dict[str, Any] | None = None,
                 storage: Any = None, idempotency_key: str | None = None) -> ToolContext:
    ctx = RequestContext(user_id=world.user_id, tenant_id=world.tenant_id, role="owner", permissions=frozenset())
    services: Any = SimpleNamespace(session_factory=get_session_factory(), settings=settings or executor_settings(),
                                    storage=storage or FakeStorage())
    return ToolContext(ctx=ctx, task_id=world.task_id, step_id=step.id, step_key=step.step_key,
                       attempt_number=attempt, idempotency_key=idempotency_key or step.idempotency_key,
                       services=services, org_policy=org_policy or OrganizationPolicy(), strategy=strategy or {})


def job_context(tenant_id: uuid.UUID, browser_task_id: uuid.UUID, *, attempt: int = 1, max_attempts: int = 5,
                worker_id: str = "browser-test-worker") -> tuple[JobContext, dict[str, Any]]:
    payload = {"browser_task_id": str(browser_task_id), "tenant_id": str(tenant_id)}
    job = ClaimedJob(id=uuid.uuid4(), queue="browser", job_type="browser.run", payload=payload, attempts=attempt,
                     max_attempts=max_attempts, tenant_id=tenant_id)
    return JobContext(job=job, worker_id=worker_id, session_factory=get_session_factory()), payload


class ScriptedExecutor:
    """Stands in for BrowserExecutor: records requests and returns scripted results."""

    def __init__(self, *results: BrowserRunResult | BaseException) -> None:
        self.results = list(results)
        self.requests: list[BrowserRunRequest] = []

    async def run(self, request: BrowserRunRequest) -> BrowserRunResult:
        self.requests.append(request)
        if request.on_active is not None:
            await request.on_active()
        outcome = self.results.pop(0) if self.results else BrowserRunResult(ok=True)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome
