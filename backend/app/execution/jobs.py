"""Execution worker jobs."""

from __future__ import annotations

import uuid
from typing import Any

from app.execution.engine import ExecutionEngine
from app.workers.jobs.registry import JobContext, job

_engines: dict[str, ExecutionEngine] = {}


def _engine(ctx: JobContext) -> ExecutionEngine:
    engine = _engines.get(ctx.worker_id)
    if engine is None:
        from app.tools.services import get_tool_services
        from app.workers.queues.postgres import get_job_queue

        engine = ExecutionEngine(services=get_tool_services(), session_factory=ctx.session_factory,
                                 queue=get_job_queue(), worker_id=ctx.worker_id)
        _engines[ctx.worker_id] = engine
    return engine


@job("task.execute")
async def execute_task(ctx: JobContext, payload: dict[str, Any]) -> None:
    await _engine(ctx).run(uuid.UUID(payload["task_id"]), uuid.UUID(payload["tenant_id"]))
