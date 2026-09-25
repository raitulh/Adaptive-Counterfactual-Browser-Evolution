"""
Background worker thread: webhook delivery, session expiry, data retention.

Safe to run in several processes — deliveries and expiries are claimed with
`FOR UPDATE SKIP LOCKED` on PostgreSQL — but one worker is usually enough;
set WORKER_ENABLED=false on the others.
"""

from __future__ import annotations

import logging
import threading
import time

from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.services.retention import purge_expired_data
from app.services.session_service import expire_stale_sessions
from app.services.webhook_service import WebhookDispatcher

logger = logging.getLogger("realhuman.worker")

EXPIRY_EVERY_SECONDS = 15.0
RETENTION_EVERY_SECONDS = 3600.0


class BackgroundWorker:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        dispatcher: WebhookDispatcher,
        clock: Clock,
        interval_seconds: float,
    ) -> None:
        self._sessions = session_factory
        self._dispatcher = dispatcher
        self._clock = clock
        self._interval = interval_seconds
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="realhuman-worker", daemon=True)
        self._last_expiry = 0.0
        self._last_retention = 0.0

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._thread.join(timeout)

    def tick(self) -> None:
        """One pass of every job that is due."""
        monotonic = time.monotonic()
        self._guard("webhooks", lambda: self._dispatcher.run_once())
        if monotonic - self._last_expiry >= EXPIRY_EVERY_SECONDS:
            self._last_expiry = monotonic
            self._guard("expiry", self._expire)
        if monotonic - self._last_retention >= RETENTION_EVERY_SECONDS:
            self._last_retention = monotonic
            self._guard("retention", self._retention)

    def _expire(self) -> None:
        with self._sessions() as db:
            expire_stale_sessions(db, self._clock.now())

    def _retention(self) -> None:
        with self._sessions() as db:
            removed = purge_expired_data(db, self._clock.now())
        if any(removed.values()):
            logger.info("retention purge", extra={"removed": removed})

    def _guard(self, job: str, run) -> None:
        try:
            run()
        except Exception:  # keep the worker alive; the next tick retries
            logger.exception("background job failed", extra={"job": job})

    def _run(self) -> None:
        while not self._stop.wait(self._interval):
            self.tick()
