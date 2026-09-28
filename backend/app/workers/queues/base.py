"""Queue abstraction.

Business logic only calls ``enqueue`` (inside its own DB transaction, so a job
exists iff the state change that requires it committed). Workers ``claim``
jobs under a time-bounded lease, ``heartbeat`` while working and
``complete``/``fail``/``release`` them. A crashed worker's lease simply
expires and ``recover_expired_leases`` makes the job claimable again.

A Kafka/PubSub backend would implement the same protocol by writing enqueue
requests to the transactional outbox and relaying them.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from sqlalchemy.ext.asyncio import AsyncSession


class Queues:
    PLANNING = "planning"
    EXECUTION = "execution"
    BROWSER = "browser"
    MEMORY = "memory"
    NOTIFICATIONS = "notifications"
    FILES = "files"
    MAINTENANCE = "maintenance"
    EVALUATION = "evaluation"

    # Evaluation runs swap process-level singletons (scripted model, simulated providers), so they run
    # on a dedicated worker: ``python -m app.workers.worker --queues evaluation``.
    DEFAULT_WORKER = (PLANNING, EXECUTION, MEMORY, NOTIFICATIONS, FILES, MAINTENANCE)
    EVALUATION_WORKER = (EVALUATION,)


@dataclass(slots=True)
class JobSpec:
    queue: str
    job_type: str
    payload: dict[str, Any] = field(default_factory=dict)
    priority: int = 100
    run_at: datetime | None = None
    delay_seconds: float = 0.0
    max_attempts: int | None = None
    dedupe_key: str | None = None
    tenant_id: uuid.UUID | None = None


@dataclass(slots=True)
class ClaimedJob:
    id: uuid.UUID
    queue: str
    job_type: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int
    tenant_id: uuid.UUID | None


class JobQueue(Protocol):
    async def enqueue(self, session: AsyncSession, spec: JobSpec) -> None: ...

    async def claim(self, queues: list[str], limit: int, worker_id: str) -> list[ClaimedJob]: ...

    async def heartbeat(self, job_id: uuid.UUID, worker_id: str) -> bool: ...

    async def complete(self, job_id: uuid.UUID, worker_id: str) -> None: ...

    async def fail(self, job_id: uuid.UUID, worker_id: str, error: str, *, retry_in: float | None) -> str: ...

    async def release(self, job_id: uuid.UUID, worker_id: str, *, delay_seconds: float) -> None: ...

    async def recover_expired_leases(self) -> int: ...


class RetryJob(Exception):
    """Handler asks for the job to be retried later (consumes an attempt)."""

    def __init__(self, reason: str, delay_seconds: float = 5.0) -> None:
        super().__init__(reason)
        self.delay_seconds = delay_seconds


class DeferJob(Exception):
    """Handler cannot run *yet* (e.g. task lease held elsewhere); retry without consuming an attempt."""

    def __init__(self, reason: str, delay_seconds: float = 2.0) -> None:
        super().__init__(reason)
        self.delay_seconds = delay_seconds


class PermanentJobFailure(Exception):
    """Handler failed in a way retries cannot fix; the job is dead-lettered."""
