"""Fixtures for browser integration tests: a tenant with a running task, steps waiting on an
isolated worker, and a deterministic resolver."""

from __future__ import annotations

import sys
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
import pytest_asyncio

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from browser_itkit import World  # noqa: E402

from app.core.database import get_session_factory  # noqa: E402


@pytest_asyncio.fixture
async def world() -> World:
    from app.organizations.models import Organization
    from app.tasks.models import Task
    from app.users.models import User

    async with get_session_factory()() as s:
        s.info["system"] = True
        suffix = uuid.uuid4().hex[:10]
        org = Organization(name="Browser Org", slug=f"browser-{suffix}")
        user = User(email=f"browser-{suffix}@example.com")
        s.add_all([org, user])
        await s.flush()
        task = Task(tenant_id=org.id, user_id=user.id, goal="use the browser", status="running")
        s.add(task)
        await s.flush()
        ids = World(org.id, user.id, task.id)
        await s.commit()
    return ids


StepFactory = Callable[..., Awaitable[Any]]


@pytest.fixture
def make_step(world: World) -> StepFactory:
    from app.tasks.models import TaskStep

    async def _make(tool_name: str = "browser.navigate", *, status: str = "waiting_external",
                    idempotency_key: str | None = None) -> TaskStep:
        async with get_session_factory()() as s:
            s.info["tenant_id"] = world.tenant_id
            step = TaskStep(tenant_id=world.tenant_id, task_id=world.task_id, step_key=f"s{uuid.uuid4().hex[:6]}",
                            position=0, action="browse", tool_name=tool_name, status=status,
                            idempotency_key=idempotency_key or f"{world.task_id}:{uuid.uuid4().hex}")
            s.add(step)
            await s.commit()
            return step

    return _make


@pytest.fixture
def resolver(monkeypatch: pytest.MonkeyPatch) -> Callable[[dict[str, str]], list[str]]:
    from browser_testkit import install_resolver

    def _install(mapping: dict[str, str]) -> list[str]:
        return install_resolver(monkeypatch, mapping)

    return _install
