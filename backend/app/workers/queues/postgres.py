"""PostgreSQL-backed durable queue (``SELECT … FOR UPDATE SKIP LOCKED`` + leases)."""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.common.ids import new_id
from app.common.time import utcnow
from app.core.config import get_settings
from app.workers.queues.base import ClaimedJob, JobSpec
from app.workers.queues.models import Job, JobStatus

logger = logging.getLogger(__name__)

_CLAIM_SQL = text(
    """
    UPDATE jobs SET status = 'running', locked_by = :worker, attempts = attempts + 1,
           locked_until = now() + make_interval(secs => :lease), updated_at = now()
    WHERE id IN (
        SELECT id FROM jobs
        WHERE status = 'pending' AND queue = ANY(:queues) AND run_at <= now()
        ORDER BY priority, run_at
        LIMIT :limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING id, queue, job_type, payload, attempts, max_attempts, tenant_id
    """
)


class PostgresJobQueue:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], lease_seconds: int | None = None,
                 default_max_attempts: int | None = None) -> None:
        settings = get_settings()
        self._sf = session_factory
        self.lease_seconds = lease_seconds or settings.job_lease_seconds
        self.default_max_attempts = default_max_attempts or settings.job_max_attempts

    async def enqueue(self, session: AsyncSession, spec: JobSpec) -> None:
        run_at = spec.run_at or (utcnow() + timedelta(seconds=spec.delay_seconds))
        values: dict[str, Any] = {
            "id": new_id(),
            "queue": spec.queue,
            "job_type": spec.job_type,
            "payload": spec.payload,
            "status": JobStatus.PENDING,
            "priority": spec.priority,
            "run_at": run_at,
            "attempts": 0,
            "max_attempts": spec.max_attempts or self.default_max_attempts,
            "dedupe_key": spec.dedupe_key,
            "tenant_id": spec.tenant_id,
        }
        stmt = insert(Job).values(**values)
        if spec.dedupe_key:
            # Coalesce with an existing pending job, pulling it forward if the new one is sooner.
            stmt = stmt.on_conflict_do_update(
                index_elements=[Job.queue, Job.dedupe_key],
                index_where=text("status = 'pending' AND dedupe_key IS NOT NULL"),
                set_={
                    "run_at": func.least(Job.run_at, stmt.excluded.run_at),
                    "priority": func.least(Job.priority, stmt.excluded.priority),
                    "payload": stmt.excluded.payload,
                    "updated_at": func.now(),
                },
            )
        await session.execute(stmt, execution_options={"skip_tenant_scope": True})

    async def claim(self, queues: list[str], limit: int, worker_id: str) -> list[ClaimedJob]:
        async with self._sf() as session:
            session.info["system"] = True
            rows = (
                await session.execute(
                    _CLAIM_SQL,
                    {"worker": worker_id, "lease": self.lease_seconds, "queues": queues, "limit": limit},
                )
            ).mappings().all()
            await session.commit()
        return [
            ClaimedJob(
                id=r["id"], queue=r["queue"], job_type=r["job_type"], payload=r["payload"] or {},
                attempts=r["attempts"], max_attempts=r["max_attempts"], tenant_id=r["tenant_id"],
            )
            for r in rows
        ]

    async def heartbeat(self, job_id: uuid.UUID, worker_id: str) -> bool:
        async with self._sf() as session:
            session.info["system"] = True
            result = await session.execute(
                update(Job)
                .where(Job.id == job_id, Job.locked_by == worker_id, Job.status == JobStatus.RUNNING)
                .values(locked_until=utcnow() + timedelta(seconds=self.lease_seconds))
            )
            await session.commit()
            return bool(result.rowcount)  # type: ignore[attr-defined]

    async def complete(self, job_id: uuid.UUID, worker_id: str) -> None:
        async with self._sf() as session:
            session.info["system"] = True
            await session.execute(
                update(Job)
                .where(Job.id == job_id, Job.locked_by == worker_id)
                .values(status=JobStatus.SUCCEEDED, finished_at=utcnow(), locked_by=None, locked_until=None)
            )
            await session.commit()

    async def fail(self, job_id: uuid.UUID, worker_id: str, error: str, *, retry_in: float | None) -> str:
        async with self._sf() as session:
            session.info["system"] = True
            job = await session.get(Job, job_id, with_for_update=True)
            if job is None or job.locked_by != worker_id:
                await session.rollback()
                return "lost"
            job.last_error = error[:4000]
            job.locked_by = None
            job.locked_until = None
            if retry_in is None or job.attempts >= job.max_attempts:
                job.status = JobStatus.DEAD
                job.finished_at = utcnow()
                outcome = "dead"
            else:
                job.status = JobStatus.PENDING
                job.run_at = utcnow() + timedelta(seconds=retry_in)
                outcome = "retry"
            try:
                await session.commit()
            except Exception:
                # A pending duplicate (same dedupe key) already exists: that job will do the work.
                await session.rollback()
                async with self._sf() as s2:
                    s2.info["system"] = True
                    await s2.execute(update(Job).where(Job.id == job_id).values(
                        status=JobStatus.CANCELLED, finished_at=utcnow(), locked_by=None, locked_until=None,
                        last_error="coalesced into pending duplicate"))
                    await s2.commit()
                outcome = "coalesced"
            return outcome

    async def release(self, job_id: uuid.UUID, worker_id: str, *, delay_seconds: float) -> None:
        async with self._sf() as session:
            session.info["system"] = True
            job = await session.get(Job, job_id, with_for_update=True)
            if job is None or job.locked_by != worker_id:
                await session.rollback()
                return
            job.status = JobStatus.PENDING
            job.attempts = max(0, job.attempts - 1)
            job.locked_by = None
            job.locked_until = None
            job.run_at = utcnow() + timedelta(seconds=delay_seconds)
            try:
                await session.commit()
            except Exception:
                await session.rollback()
                async with self._sf() as s2:
                    s2.info["system"] = True
                    await s2.execute(update(Job).where(Job.id == job_id).values(
                        status=JobStatus.CANCELLED, finished_at=utcnow(), locked_by=None, locked_until=None,
                        last_error="coalesced into pending duplicate"))
                    await s2.commit()

    async def recover_expired_leases(self) -> int:
        """Return jobs whose worker died (lease expired) to the pending state."""
        async with self._sf() as session:
            session.info["system"] = True
            dead = await session.execute(
                text(
                    """
                    UPDATE jobs SET status = 'dead', finished_at = now(), locked_by = NULL, locked_until = NULL,
                           last_error = coalesce(last_error, '') || ' [lease expired on final attempt]'
                    WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts
                    """
                )
            )
            revived = await session.execute(
                text(
                    """
                    UPDATE jobs j SET status = 'pending', locked_by = NULL, locked_until = NULL, run_at = now()
                    WHERE j.status = 'running' AND j.locked_until < now()
                      AND NOT EXISTS (
                        SELECT 1 FROM jobs p WHERE p.status = 'pending' AND p.queue = j.queue
                          AND p.dedupe_key = j.dedupe_key AND j.dedupe_key IS NOT NULL)
                    """
                )
            )
            await session.execute(
                text(
                    """
                    UPDATE jobs SET status = 'cancelled', finished_at = now(), locked_by = NULL, locked_until = NULL,
                           last_error = 'lease expired; coalesced into pending duplicate'
                    WHERE status = 'running' AND locked_until < now()
                    """
                )
            )
            await session.commit()
            count = (revived.rowcount or 0) + (dead.rowcount or 0)  # type: ignore[attr-defined]
            if count:
                logger.warning("recovered expired job leases", extra={"count": count})
            return count


_queue: PostgresJobQueue | None = None


def get_job_queue() -> PostgresJobQueue:
    global _queue
    if _queue is None:
        from app.core.database import get_session_factory

        _queue = PostgresJobQueue(get_session_factory())
    return _queue


def set_job_queue(queue: PostgresJobQueue | None) -> None:
    global _queue
    _queue = queue
