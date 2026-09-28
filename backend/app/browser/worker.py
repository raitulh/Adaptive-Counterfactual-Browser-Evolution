"""Isolated browser worker process (entrypoint ``agentos-browser-worker``).

    agentos-browser-worker [--concurrency N] [--no-sandbox]

Runs the generic durable-queue ``Worker`` on the ``browser`` queue only, with concurrency
``BROWSER_MAX_CONCURRENCY``, no outbox relay, and a single ``BrowserExecutor`` shared by
its jobs (one Chromium process, a fresh context per task). Deploy it in its own
container/network namespace: it is the only process that runs Chromium.

``--no-sandbox`` (or ``BROWSER_NO_SANDBOX=1``) disables Chromium's own sandbox; use it
only where the container already provides equivalent isolation (e.g. running as root
under a restrictive seccomp profile).
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import importlib
import logging
import os
import signal

from app.core.config import get_settings
from app.core.logging import configure_logging
from app.core.telemetry import configure_error_reporting, configure_tracing
from app.workers.queues.base import Queues
from app.workers.worker import Worker

logger = logging.getLogger("agentos.browser_worker")


def _env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


async def run_browser_worker(*, concurrency: int | None = None, no_sandbox: bool = False) -> None:
    settings = get_settings()
    settings.validate_for_startup()
    configure_logging(settings.log_level, settings.log_json)
    configure_tracing(settings)
    configure_error_reporting(settings)
    if not settings.browser_enabled:
        logger.warning("browser automation is disabled (BROWSER_ENABLED=false); browser worker exiting")
        return
    if settings.worker_metrics_port:
        from prometheus_client import start_http_server

        start_http_server(settings.worker_metrics_port)

    # Registers the ``browser.run`` handler even if the shared registry does not list it.
    importlib.import_module("app.browser.jobs")
    from app.browser.executor import BrowserExecutor
    from app.browser.jobs import BrowserJobRunner, set_browser_job_runner
    from app.files.storage import build_storage

    executor = BrowserExecutor(settings, build_storage(settings), no_sandbox=no_sandbox)
    set_browser_job_runner(BrowserJobRunner(executor, settings=settings))
    worker = Worker([Queues.BROWSER], concurrency or settings.browser_max_concurrency, kind="browser",
                    run_outbox=False)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        with contextlib.suppress(NotImplementedError):
            loop.add_signal_handler(sig, worker.request_stop)
    try:
        await worker.run()
    finally:
        from app.core.database import dispose_engine
        from app.core.redis import close_redis

        await executor.aclose()
        set_browser_job_runner(None)
        await close_redis()
        await dispose_engine()


def main() -> None:
    parser = argparse.ArgumentParser(description="AgentOS isolated browser worker")
    parser.add_argument("--concurrency", type=int, default=None,
                        help="concurrent browser tasks (default: BROWSER_MAX_CONCURRENCY)")
    parser.add_argument("--no-sandbox", action="store_true", default=_env_flag("BROWSER_NO_SANDBOX"),
                        help="disable the Chromium sandbox (only inside an equivalently isolated container)")
    args = parser.parse_args()
    asyncio.run(run_browser_worker(concurrency=args.concurrency, no_sandbox=args.no_sandbox))


if __name__ == "__main__":
    main()
