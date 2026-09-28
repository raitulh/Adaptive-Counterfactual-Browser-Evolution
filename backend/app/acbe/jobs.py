"""acbe background jobs.

* ``acbe.analyze_task_failures`` (enqueued by the execution engine when a task fails):
  cheap and idempotent — analyses only the fingerprints of that task's verified failures and,
  when a learnable pattern becomes significant and ACBE is enabled for the tenant, creates a
  draft candidate and enqueues its experiment.
* ``acbe.run_experiment``: baseline vs candidate evaluation + promotion gate. Runs the
  evaluation harness, so it needs a dedicated evaluation worker (deferred elsewhere).
"""

from __future__ import annotations

import uuid
from typing import Any

from app.acbe.experiments import run_experiment
from app.acbe.service import process_task_failures
from app.core.exceptions import NotFound
from app.evaluation.runner import ensure_dedicated_evaluation_worker
from app.workers.jobs.registry import JobContext, job


@job("acbe.analyze_task_failures")
async def analyze_task_failures(ctx: JobContext, payload: dict[str, Any]) -> None:
    tenant_id, task_id = uuid.UUID(payload["tenant_id"]), uuid.UUID(payload["task_id"])
    async with ctx.session_factory() as session:
        session.info["tenant_id"] = tenant_id
        await process_task_failures(session, tenant_id, task_id)


@job("acbe.run_experiment")
async def run_candidate_experiment(ctx: JobContext, payload: dict[str, Any]) -> None:
    await ensure_dedicated_evaluation_worker(ctx.worker_id)
    try:
        await run_experiment(uuid.UUID(payload["candidate_id"]))
    except NotFound:
        return  # candidate deleted (organization removed): nothing to evaluate
