"""Automation background jobs (idempotent; at-least-once delivery).

``automation.sync_runs`` settles open runs whose task reached an outcome. It also runs as
part of ``maintenance.recover_stalled_tasks`` every minute; enqueue it directly (dedupe key
``automation.sync_runs``) for faster feedback, e.g. when a task finishes.
"""

from __future__ import annotations

import logging
from typing import Any

from app.automations.service import sync_run_outcomes
from app.workers.jobs.registry import JobContext, job

logger = logging.getLogger("agentos.automations")

SYNC_RUNS_JOB = "automation.sync_runs"


@job(SYNC_RUNS_JOB)
async def sync_runs_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    limit = max(1, min(int(payload.get("limit") or 200), 1000))
    async with ctx.session_factory() as session:
        session.info["system"] = True
        settled = await sync_run_outcomes(session, limit=limit)
    if settled:
        logger.info("automation runs settled", extra={"count": settled})
