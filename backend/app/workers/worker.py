"""Background worker process.

    python -m app.workers.worker --queues planning,execution,memory,notifications,files,maintenance,evaluation

* Stateless: all durable state is in PostgreSQL; a crashed worker's leases expire
  and its jobs (and task leases) are picked up by another worker.
* Concurrency-limited, lease-heartbeating, graceful on SIGTERM (stops claiming,
  lets in-flight jobs finish within the grace period).
* Retries with exponential backoff; jobs that exhaust attempts are dead-lettered
  (status ``dead``) and visible to admins.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
import random
import signal
import socket
import time
from typing import Any

from sqlalchemy.dialects.postgresql import insert

from app.common.events import get_event_bus
from app.common.ids import worker_identity
from app.common.models import WorkerHeartbeat
from app.common.outbox import OutboxRelay
from app.common.time import utcnow
from app.core import metrics
from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.logging import configure_logging, log_context
from app.core.telemetry import configure_error_reporting, configure_tracing, get_error_reporter, span
from app.workers.jobs.registry import JobContext, get_handler, load_handlers
from app.workers.queues.base import ClaimedJob, DeferJob, PermanentJobFailure, Queues, RetryJob
from app.workers.queues.postgres import PostgresJobQueue, get_job_queue

logger = logging.getLogger("agentos.worker")


class Worker:
    def __init__(self, queues: list[str], concurrency: int, *, queue: PostgresJobQueue | None = None,
                 worker_id: str | None = None, kind: str = "worker", run_outbox: bool = True) -> None:
        self.settings = get_settings()
        self.queues = queues
        self.concurrency = max(1, concurrency)
        self.queue = queue or get_job_queue()
        self.worker_id = worker_id or worker_identity()
        self.kind = kind
        self.run_outbox = run_outbox
        self.sf = get_session_factory()
        self._stopping = asyncio.Event()
        self._inflight: dict[Any, asyncio.Task[None]] = {}
        self._processed = 0
        self._started = utcnow()

    def request_stop(self) -> None:
        self._stopping.set()

    async def run(self) -> None:
        load_handlers()
        logger.info("worker started", extra={"worker_id": self.worker_id, "queues": self.queues,
                                             "concurrency": self.concurrency})
        background = [asyncio.create_task(self._maintenance_loop()), asyncio.create_task(self._heartbeat_loop())]
        if self.run_outbox:
            background.append(asyncio.create_task(self._outbox_loop()))
        try:
            while not self._stopping.is_set():
                free = self.concurrency - len(self._inflight)
                jobs: list[ClaimedJob] = []
                if free > 0:
                    try:
                        jobs = await self.queue.claim(self.queues, free, self.worker_id)
                    except Exception:
                        logger.exception("claim failed; backing off")
                        await self._sleep(2.0)
                        continue
                for job in jobs:
                    task = asyncio.create_task(self._process(job))
                    self._inflight[job.id] = task
                    task.add_done_callback(self._forget(job.id))
                if not jobs:
                    await self._sleep(self.settings.worker_poll_interval_seconds * (1 + random.random() * 0.5))  # noqa: S311
        finally:
            await self._drain()
            for task in background:
                task.cancel()
            with contextlib.suppress(Exception):
                await asyncio.gather(*background, return_exceptions=True)
            logger.info("worker stopped", extra={"worker_id": self.worker_id, "processed": self._processed})

    def _forget(self, job_id: Any) -> Any:
        def _callback(_task: asyncio.Task[None]) -> None:
            self._inflight.pop(job_id, None)

        return _callback

    async def _sleep(self, seconds: float) -> None:
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)

    async def _drain(self) -> None:
        if not self._inflight:
            return
        logger.info("draining in-flight jobs", extra={"count": len(self._inflight)})
        _, pending = await asyncio.wait(list(self._inflight.values()),
                                           timeout=self.settings.worker_shutdown_grace_seconds)
        for task in pending:
            task.cancel()  # leases will expire and the jobs will be picked up elsewhere
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

    async def _process(self, job: ClaimedJob) -> None:
        handler = get_handler(job.job_type)
        metrics.jobs_in_flight.labels(job.queue).inc()
        keeper = asyncio.create_task(self._job_heartbeat(job))
        started = time.perf_counter()
        outcome = "succeeded"
        try:
            with log_context(tenant_id=job.tenant_id), span("job.run", **{"job.type": job.job_type,
                                                                          "job.queue": job.queue}):
                if handler is None:
                    raise PermanentJobFailure(f"no handler registered for job type {job.job_type}")
                await handler(JobContext(job=job, worker_id=self.worker_id, session_factory=self.sf), job.payload)
            await self.queue.complete(job.id, self.worker_id)
        except DeferJob as exc:
            outcome = "deferred"
            await self.queue.release(job.id, self.worker_id, delay_seconds=exc.delay_seconds)
        except RetryJob as exc:
            outcome = await self.queue.fail(job.id, self.worker_id, str(exc), retry_in=exc.delay_seconds)
        except PermanentJobFailure as exc:
            outcome = await self.queue.fail(job.id, self.worker_id, str(exc), retry_in=None)
            logger.error("job dead-lettered", extra={"job_type": job.job_type, "reason": str(exc)[:300]})
        except asyncio.CancelledError:
            outcome = "cancelled"
            raise
        except Exception as exc:
            get_error_reporter().capture(exc, job_type=job.job_type, job_id=str(job.id))
            delay = min(600.0, 2 ** job.attempts * 2.0) * (1 + random.random() * 0.3)  # noqa: S311
            outcome = await self.queue.fail(job.id, self.worker_id, f"{type(exc).__name__}: {exc}"[:2000],
                                            retry_in=delay)
            logger.exception("job failed", extra={"job_type": job.job_type, "outcome": outcome})
        finally:
            keeper.cancel()
            metrics.jobs_in_flight.labels(job.queue).dec()
            metrics.jobs_processed_total.labels(job.queue, job.job_type, outcome).inc()
            self._processed += 1
            logger.info("job finished", extra={"job_type": job.job_type, "outcome": outcome,
                                               "duration_ms": round((time.perf_counter() - started) * 1000, 1)})

    async def _job_heartbeat(self, job: ClaimedJob) -> None:
        interval = max(5.0, self.queue.lease_seconds / 3)
        with contextlib.suppress(asyncio.CancelledError):
            while True:
                await asyncio.sleep(interval)
                try:
                    await self.queue.heartbeat(job.id, self.worker_id)
                except Exception:
                    logger.warning("job heartbeat failed", extra={"job_id": str(job.id)})

    async def _maintenance_loop(self) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            while True:
                await asyncio.sleep(15 + random.random() * 15)  # noqa: S311
                with contextlib.suppress(Exception):
                    await self.queue.recover_expired_leases()

    async def _outbox_loop(self) -> None:
        relay = OutboxRelay(self.sf, get_event_bus())
        with contextlib.suppress(asyncio.CancelledError):
            while True:
                try:
                    published = await relay.run_once()
                except Exception:
                    logger.warning("outbox relay failed", exc_info=True)
                    published = 0
                await asyncio.sleep(0.05 if published else 0.25)

    async def _heartbeat_loop(self) -> None:
        with contextlib.suppress(asyncio.CancelledError):
            while True:
                try:
                    async with self.sf() as s:
                        s.info["system"] = True
                        stmt = insert(WorkerHeartbeat).values(
                            worker_id=self.worker_id, kind=self.kind, queues=self.queues, started_at=self._started,
                            last_seen_at=utcnow(), jobs_in_flight=len(self._inflight),
                            jobs_processed=self._processed, host=socket.gethostname())
                        await s.execute(stmt.on_conflict_do_update(index_elements=["worker_id"], set_={
                            "last_seen_at": utcnow(), "jobs_in_flight": len(self._inflight),
                            "jobs_processed": self._processed}))
                        await s.commit()
                except Exception:
                    logger.warning("worker heartbeat failed")
                await asyncio.sleep(10)


def _install_signal_handlers(worker: Worker) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, worker.request_stop)


async def _main(queues: list[str], concurrency: int) -> None:
    settings = get_settings()
    settings.validate_for_startup()
    configure_logging(settings.log_level, settings.log_json)
    configure_tracing(settings)
    configure_error_reporting(settings)
    if settings.worker_metrics_port:
        from prometheus_client import start_http_server

        start_http_server(settings.worker_metrics_port)
    worker = Worker(queues, concurrency)
    _install_signal_handlers(worker)
    try:
        await worker.run()
    finally:
        from app.core.database import dispose_engine
        from app.core.redis import close_redis

        await close_redis()
        await dispose_engine()


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentOS background worker")
    parser.add_argument("--queues", default=os.environ.get("WORKER_QUEUES", ",".join(Queues.DEFAULT_WORKER)))
    parser.add_argument("--concurrency", type=int, default=get_settings().worker_concurrency)
    args = parser.parse_args()
    asyncio.run(_main([q.strip() for q in args.queues.split(",") if q.strip()], args.concurrency))


if __name__ == "__main__":
    main()
