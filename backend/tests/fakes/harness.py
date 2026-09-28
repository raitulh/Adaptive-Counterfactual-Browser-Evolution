"""Test harness wiring the real engine/planner/tools to simulated providers."""

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from typing import Any

import httpx
from sqlalchemy import select, text, update

from app.common.time import utcnow
from app.core.database import get_session_factory
from app.evaluation.simulators.google_workspace import FakeGoogleWorkspace
from app.integrations.google.oauth import CAPABILITY_SCOPES, GoogleIdentity, GoogleOAuthClient, GoogleTokenResponse
from app.integrations.service import store_google_connection
from app.integrations.vault import CredentialVault
from app.model_gateway.providers.scripted import ScriptedProvider
from app.model_gateway.router import ModelRouter, set_model_router
from app.model_gateway.types import ModelRequest
from app.tools.services import ToolServices, set_tool_services
from app.workers.queues.models import Job
from app.workers.queues.postgres import get_job_queue
from app.workers.worker import Worker
from tests.fakes.storage import MemoryStorage

ALL_GOOGLE_SCOPES = ["openid", "email", "profile", *CAPABILITY_SCOPES["calendar.write"],
                     *CAPABILITY_SCOPES["calendar.read"], *CAPABILITY_SCOPES["gmail.send"],
                     *CAPABILITY_SCOPES["gmail.read"], *CAPABILITY_SCOPES["gmail.compose"],
                     *CAPABILITY_SCOPES["contacts.read"], *CAPABILITY_SCOPES["drive.read"]]


class Harness:
    def __init__(self) -> None:
        self.google = FakeGoogleWorkspace()
        self.http = httpx.AsyncClient(transport=self.google.transport())
        self.plans: dict[str, Any] = {}
        self.model_responses: dict[str, Callable[[ModelRequest], str | Exception]] = {}
        self.provider = ScriptedProvider(self._handle)
        from app.core.redis import get_redis

        self.model = ModelRouter(self.provider, usage_sink=None)
        sf = get_session_factory()
        self.services = ToolServices(
            session_factory=sf,
            vault=CredentialVault(sf, google_oauth=GoogleOAuthClient(http=self.http), redis=get_redis()),
            model=self.model, google_http=self.http, storage=MemoryStorage(), search=None)
        set_tool_services(self.services)
        set_model_router(self.model)
        self.worker = Worker(["planning", "execution", "memory", "notifications", "maintenance", "evaluation"],
                             concurrency=1, worker_id=f"test-worker-{uuid.uuid4().hex[:6]}", run_outbox=False)

    def _handle(self, request: ModelRequest) -> str | Exception:
        handler = self.model_responses.get(request.metadata.purpose)
        if handler is not None:
            return handler(request)
        if request.metadata.purpose == "planning":
            plan = self.plans.get("default")
            if callable(plan):
                return plan(request)
            return json.dumps(plan)
        from app.core.exceptions import ModelUnavailable

        return ModelUnavailable(f"no scripted response for {request.metadata.purpose}")

    async def connect_google(self, tenant_id: uuid.UUID, user_id: uuid.UUID, scopes: list[str] | None = None,
                             email: str = "owner@example.com") -> str:
        scopes = scopes or ALL_GOOGLE_SCOPES
        access, refresh = self.google.issue_tokens(scopes)
        async with get_session_factory()() as s:
            s.info["tenant_id"] = tenant_id
            await store_google_connection(
                s, tenant_id=tenant_id, user_id=user_id,
                tokens=GoogleTokenResponse(access_token=access, expires_in=3600, scope=set(scopes),
                                           token_type="Bearer", refresh_token=refresh),
                identity=GoogleIdentity(subject=f"sub-{user_id}", email=email, email_verified=True, name="Owner"))
            await s.commit()
        return refresh

    async def run_jobs(self, max_jobs: int = 100, *, fast_forward: bool = True) -> int:
        """Run claimable jobs inline until the queue is idle."""
        from app.workers.jobs.registry import load_handlers

        load_handlers()
        processed = 0
        queue = get_job_queue()
        while processed < max_jobs:
            if fast_forward:
                await self.fast_forward()
            jobs = await queue.claim(self.worker.queues, 1, self.worker.worker_id)
            if not jobs:
                break
            await self.worker._process(jobs[0])
            processed += 1
        return processed

    async def fast_forward(self) -> None:
        """Make delayed jobs and scheduled step retries due now (simulated passage of time)."""
        async with get_session_factory()() as s:
            s.info["system"] = True
            await s.execute(update(Job).where(Job.status == "pending", Job.run_at > utcnow())
                            .values(run_at=utcnow()))
            await s.execute(text("UPDATE task_steps SET next_attempt_at = now() "
                                 "WHERE status = 'retry_scheduled' AND next_attempt_at > now()"))
            await s.commit()

    async def dead_jobs(self) -> list[Job]:
        async with get_session_factory()() as s:
            s.info["system"] = True
            return list((await s.execute(select(Job).where(Job.status == "dead"))).scalars().all())

    async def close(self) -> None:
        await self.http.aclose()
        set_tool_services(None)
        set_model_router(None)
