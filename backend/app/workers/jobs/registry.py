"""Job handler registry.

Handlers are plain async functions registered by job type::

    @job("memory.embed")
    async def embed_memory(ctx: JobContext, payload: dict) -> None: ...

A handler must be idempotent (jobs are at-least-once). It may raise
``RetryJob`` (retry later, consumes an attempt), ``DeferJob`` (not yet runnable,
does not consume an attempt) or ``PermanentJobFailure`` (dead-letter).
"""

from __future__ import annotations

import importlib
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.workers.queues.base import ClaimedJob

JobHandler = Callable[["JobContext", dict[str, Any]], Awaitable[None]]


@dataclass(slots=True)
class JobContext:
    job: ClaimedJob
    worker_id: str
    session_factory: async_sessionmaker[AsyncSession]

    @property
    def attempt(self) -> int:
        return self.job.attempts

    @property
    def is_last_attempt(self) -> bool:
        return self.job.attempts >= self.job.max_attempts


_HANDLERS: dict[str, JobHandler] = {}

# Modules whose import registers handlers. Keep in sync when adding a jobs module.
HANDLER_MODULES = (
    "app.planner.jobs",
    "app.execution.jobs",
    "app.memory.jobs",
    "app.files.jobs",
    "app.notifications.jobs",
    "app.workers.jobs.maintenance",
    "app.automations.jobs",
    "app.evaluation.jobs",
    "app.acbe.jobs",
    "app.browser.jobs",
)


def job(job_type: str) -> Callable[[JobHandler], JobHandler]:
    def decorator(fn: JobHandler) -> JobHandler:
        if job_type in _HANDLERS and _HANDLERS[job_type] is not fn:
            raise ValueError(f"duplicate job handler for {job_type}")
        _HANDLERS[job_type] = fn
        return fn

    return decorator


def load_handlers() -> dict[str, JobHandler]:
    for name in HANDLER_MODULES:
        importlib.import_module(name)
    return dict(_HANDLERS)


def get_handler(job_type: str) -> JobHandler | None:
    return _HANDLERS.get(job_type)
