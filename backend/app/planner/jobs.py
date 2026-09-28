"""Planning worker jobs."""

from __future__ import annotations

import uuid
from typing import Any

from app.core.exceptions import ModelError, ModelRequestRejected
from app.planner.service import PlannerService
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import RetryJob


def _planner(ctx: JobContext) -> PlannerService:
    from app.model_gateway.router import get_model_router
    from app.workers.queues.postgres import get_job_queue

    return PlannerService(get_model_router(), ctx.session_factory, get_job_queue())


@job("task.plan")
async def plan_task(ctx: JobContext, payload: dict[str, Any]) -> None:
    planner = _planner(ctx)
    task_id, tenant_id = uuid.UUID(payload["task_id"]), uuid.UUID(payload["tenant_id"])
    try:
        await planner.plan(task_id, tenant_id)
    except ModelRequestRejected as exc:
        await planner._finish_failed(task_id, tenant_id, exc.code, "The AI model provider rejected the request.")
    except ModelError as exc:
        # Provider down / rate limited / timed out: retry the job with backoff, then fail truthfully.
        if ctx.is_last_attempt:
            await planner._finish_failed(task_id, tenant_id, exc.code,
                                         "The AI model is unavailable right now; the task could not be planned.")
            return
        raise RetryJob(f"model error: {exc.code}", delay_seconds=min(120, 10 * 2 ** ctx.attempt)) from exc
