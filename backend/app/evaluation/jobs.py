"""evaluation background jobs.

``evaluation.run`` executes a queued EvaluationRun. It must run on a dedicated evaluation
worker (``python -m app.workers.worker --queues evaluation``): the harness swaps
process-level singletons while a case runs; elsewhere the job is deferred.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.core.exceptions import NotFound
from app.evaluation.runner import ensure_dedicated_evaluation_worker, execute_run
from app.workers.jobs.registry import JobContext, job


@job("evaluation.run")
async def run_evaluation(ctx: JobContext, payload: dict[str, Any]) -> None:
    await ensure_dedicated_evaluation_worker(ctx.worker_id)
    try:
        await execute_run(uuid.UUID(payload["run_id"]))
    except NotFound:
        return  # the run was deleted (e.g. its organization was removed): nothing to do
