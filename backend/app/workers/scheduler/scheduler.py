"""Scheduler process: turns time into *jobs*. It never runs long workflows itself.

    python -m app.workers.scheduler.scheduler

Every tick it (1) materializes due automation runs into tasks (idempotently, one
run per automation per scheduled time) and (2) enqueues periodic maintenance
jobs with time-bucketed dedupe keys, so running several scheduler replicas is
safe (duplicates coalesce in the queue / unique constraints).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import signal
import time

from app.common.time import utcnow
from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.logging import configure_logging
from app.core.telemetry import configure_error_reporting, configure_tracing
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

logger = logging.getLogger("agentos.scheduler")

# (job_type, period_seconds)
PERIODIC_JOBS: tuple[tuple[str, int], ...] = (
    ("maintenance.expire_approvals", 60),
    ("maintenance.recover_stalled_tasks", 60),
    ("maintenance.aggregate_usage", 300),
    ("maintenance.retention", 3600),
    ("memory.purge_deleted", 3600),
    ("maintenance.cleanup_jobs", 3600),
)


async def enqueue_periodic(now_ts: float | None = None) -> int:
    now_ts = now_ts or time.time()
    queue = get_job_queue()
    count = 0
    async with get_session_factory()() as session:
        session.info["system"] = True
        for job_type, period in PERIODIC_JOBS:
            bucket = int(now_ts // period)
            await queue.enqueue(session, JobSpec(queue=Queues.MAINTENANCE, job_type=job_type,
                                                 payload={"bucket": bucket}, dedupe_key=f"{job_type}:{bucket}",
                                                 max_attempts=3))
            count += 1
        await session.commit()
    return count


async def run_tick() -> None:
    from app.automations.service import enqueue_due_automations

    async with get_session_factory()() as session:
        session.info["system"] = True
        created = await enqueue_due_automations(session, now=utcnow())
        if created:
            logger.info("automation runs created", extra={"count": created})
    await enqueue_periodic()


async def run_forever(stop: asyncio.Event) -> None:
    settings = get_settings()
    while not stop.is_set():
        try:
            await run_tick()
        except Exception:
            logger.exception("scheduler tick failed")
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(stop.wait(), timeout=settings.scheduler_interval_seconds)


def main() -> None:
    settings = get_settings()
    settings.validate_for_startup()
    configure_logging(settings.log_level, settings.log_json)
    configure_tracing(settings)
    configure_error_reporting(settings)

    async def _run() -> None:
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, stop.set)
        logger.info("scheduler started")
        await run_forever(stop)
        from app.core.database import dispose_engine
        from app.core.redis import close_redis

        await close_redis()
        await dispose_engine()

    asyncio.run(_run())


if __name__ == "__main__":
    main()
