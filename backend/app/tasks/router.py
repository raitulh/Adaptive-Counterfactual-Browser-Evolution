from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Header, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select

from app.api.dependencies import Ctx, DbSession, IdempotencyKeyHeader, get_stream_ctx, user_rate_limit
from app.common.context import RequestContext
from app.common.events import get_event_bus, task_channel, user_channel
from app.common.idempotency import run_idempotent
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.core.database import get_session_factory
from app.execution.summary import build_summary
from app.organizations.rbac import P
from app.tasks import service
from app.tasks.models import ExecutionLog, Task, TaskEvent
from app.tasks.schemas import (
    ExecutionLogOut,
    StepConfirmation,
    StepOut,
    TaskCreate,
    TaskDetail,
    TaskEventOut,
    TaskEventsPage,
    TaskInput,
    TaskOut,
)
from app.tasks.state import TERMINAL
from app.verification.models import VerificationResult

router = APIRouter(prefix="/tasks", tags=["tasks"])
events_router = APIRouter(prefix="/events", tags=["events"])

_TERMINAL_VALUES = {s.value for s in TERMINAL}


@router.post("", response_model=TaskOut, status_code=status.HTTP_202_ACCEPTED,
             summary="Create a task from a natural-language goal (executed asynchronously by workers)",
             dependencies=[Depends(user_rate_limit("task_create", "rate_limit_task_create_per_minute"))],
             responses={202: {"description": "Task accepted; poll or stream for progress"},
                        409: {"description": "Idempotency conflict"}, 429: {"description": "Rate/quota limit"}})
async def create_task(body: TaskCreate, request: Request, ctx: Ctx, db: DbSession,
                      idempotency_key: IdempotencyKeyHeader = None) -> JSONResponse:
    async def handler() -> tuple[int, TaskOut]:
        task, _ = await service.create_task(db, ctx, body, idempotency_key=idempotency_key)
        await db.commit()
        return 202, TaskOut.model_validate(task)

    result = await run_idempotent(ctx, idempotency_key, "POST", request.url.path, body.model_dump(mode="json"),
                                  handler)
    return JSONResponse(result.body, status_code=result.status_code,
                        headers={"Idempotent-Replayed": "true"} if result.replayed else None)


@router.get("", response_model=Page[TaskOut], summary="List tasks (newest first, cursor pagination)")
async def list_tasks(ctx: Ctx, db: DbSession, status_filter: str | None = Query(None, alias="status", max_length=40),
                     all_users: bool = Query(False, description="Organization-wide (requires tasks:read_all)"),
                     cursor: str | None = None, limit: int = Query(50, ge=1, le=200)) -> Page[TaskOut]:
    ctx.require(P.TASKS_READ)
    lim = clamp_limit(limit)
    stmt = select(Task)
    if not (all_users and ctx.has(P.TASKS_READ_ALL)):
        stmt = stmt.where(Task.user_id == ctx.user_id)
    if status_filter:
        stmt = stmt.where(Task.status == status_filter)
    rows = list((await db.execute(apply_keyset(stmt, Task, cursor, lim))).scalars().all())
    return build_page(rows, lim, TaskOut.model_validate)


@router.get("/{task_id}", response_model=TaskDetail, summary="Task with plan, steps, verification evidence")
async def get_task(task_id: uuid.UUID, ctx: Ctx, db: DbSession) -> TaskDetail:
    task = await service.get_visible_task(db, ctx, task_id)
    steps = await service.step_list(db, task)
    verifications = (await db.execute(select(VerificationResult).where(VerificationResult.task_id == task.id)
                                      .order_by(VerificationResult.verified_at))).scalars().all()
    detail = TaskDetail.model_validate(task)
    detail.plan = task.plan
    detail.steps = [StepOut.model_validate(s) for s in steps]
    from app.tasks.schemas import VerificationOut

    detail.verifications = [VerificationOut.model_validate(v) for v in verifications]
    detail.reproducibility = service.reproducibility(task)
    return detail


@router.get("/{task_id}/summary", summary="User-facing execution summary (what happened / changed / verified)")
async def get_summary(task_id: uuid.UUID, ctx: Ctx, db: DbSession) -> dict[str, Any]:
    task = await service.get_visible_task(db, ctx, task_id)
    return await build_summary(db, task)


@router.get("/{task_id}/events", response_model=TaskEventsPage, summary="Ordered task events after a sequence number")
async def list_events(task_id: uuid.UUID, ctx: Ctx, db: DbSession, after_seq: int = Query(0, ge=0),
                      limit: int = Query(100, ge=1, le=500)) -> TaskEventsPage:
    await service.get_visible_task(db, ctx, task_id)
    rows = (await db.execute(select(TaskEvent).where(TaskEvent.task_id == task_id, TaskEvent.seq > after_seq)
                             .order_by(TaskEvent.seq).limit(limit))).scalars().all()
    items = [TaskEventOut.model_validate(r) for r in rows]
    return TaskEventsPage(items=items, next_after_seq=items[-1].seq if items else None)


@router.get("/{task_id}/logs", response_model=list[ExecutionLogOut], summary="User-safe execution log")
async def list_logs(task_id: uuid.UUID, ctx: Ctx, db: DbSession, limit: int = Query(200, ge=1, le=1000)
                    ) -> list[ExecutionLogOut]:
    await service.get_visible_task(db, ctx, task_id)
    rows = (await db.execute(select(ExecutionLog).where(ExecutionLog.task_id == task_id)
                             .order_by(ExecutionLog.created_at).limit(limit))).scalars().all()
    return [ExecutionLogOut.model_validate(r) for r in rows]


@router.post("/{task_id}/cancel", response_model=TaskOut, summary="Cancel (cooperative; stops at a safe boundary)")
async def cancel(task_id: uuid.UUID, ctx: Ctx, db: DbSession) -> TaskOut:
    return TaskOut.model_validate(await service.cancel_task(db, ctx, task_id))


@router.post("/{task_id}/pause", response_model=TaskOut, summary="Pause a queued/running task")
async def pause(task_id: uuid.UUID, ctx: Ctx, db: DbSession) -> TaskOut:
    return TaskOut.model_validate(await service.pause_task(db, ctx, task_id))


@router.post("/{task_id}/resume", response_model=TaskOut, summary="Resume a paused/blocked/expired/failed task")
async def resume(task_id: uuid.UUID, ctx: Ctx, db: DbSession) -> TaskOut:
    return TaskOut.model_validate(await service.resume_task(db, ctx, task_id))


@router.post("/{task_id}/input", response_model=TaskOut, summary="Answer the task's pending question")
async def provide_input(task_id: uuid.UUID, body: TaskInput, ctx: Ctx, db: DbSession) -> TaskOut:
    return TaskOut.model_validate(await service.provide_input(db, ctx, task_id, body))


@router.post("/{task_id}/steps/{step_id}/confirm", response_model=TaskOut,
             summary="Confirm the real-world outcome of an action that could not be verified automatically")
async def confirm_step(task_id: uuid.UUID, step_id: uuid.UUID, body: StepConfirmation, ctx: Ctx, db: DbSession
                       ) -> TaskOut:
    return TaskOut.model_validate(await service.confirm_step(db, ctx, task_id, step_id, body))


# ---------------------------------------------------------------------------- streaming (SSE)
def _sse(event: str, data: Any, event_id: int | None = None) -> str:
    lines = []
    if event_id is not None:
        lines.append(f"id: {event_id}")
    lines.append(f"event: {event}")
    lines.append("data: " + json.dumps(data, default=str))
    return "\n".join(lines) + "\n\n"


async def _next_wakeup(sub: AsyncIterator[dict[str, Any]], timeout: float) -> None:
    with contextlib.suppress(TimeoutError, StopAsyncIteration):
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return
            message = await asyncio.wait_for(sub.__anext__(), timeout=remaining)
            if message.get("type") != "__idle__":
                return


@router.get("/{task_id}/events/stream", summary="Server-Sent Events stream of task events (resumable)",
            response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}},
                             "description": "`id` = event seq; reconnect with Last-Event-ID to resume"}})
async def stream_events(task_id: uuid.UUID, request: Request, db: DbSession,
                        ctx: RequestContext = Depends(get_stream_ctx),
                        last_event_id: str | None = Header(None, alias="Last-Event-ID")) -> StreamingResponse:
    await service.get_visible_task(db, ctx, task_id)
    await db.commit()  # release the pooled connection; the stream uses short sessions
    try:
        start_seq = max(0, int(last_event_id or 0))
    except ValueError:
        start_seq = 0

    async def generator() -> AsyncIterator[str]:
        last = start_seq
        sub = get_event_bus().subscribe(task_channel(task_id))
        sf = get_session_factory()
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                async with sf() as s:
                    s.info["tenant_id"] = ctx.tenant_id
                    rows = (await s.execute(select(TaskEvent).where(TaskEvent.task_id == task_id,
                                                                    TaskEvent.seq > last)
                                            .order_by(TaskEvent.seq).limit(200))).scalars().all()
                    status_now = (await s.execute(select(Task.status).where(Task.id == task_id))).scalar_one()
                for row in rows:
                    last = row.seq
                    yield _sse(row.event_type, {"seq": row.seq, "task_id": str(task_id), "step_id": row.step_id,
                                                "payload": row.payload, "created_at": row.created_at}, row.seq)
                if not rows and status_now in _TERMINAL_VALUES:
                    yield _sse("end", {"task_id": str(task_id), "status": status_now})
                    return
                if not rows:
                    yield ": keep-alive\n\n"
                    await _next_wakeup(sub, 15.0)
        finally:
            with contextlib.suppress(Exception):
                await sub.aclose()  # type: ignore[attr-defined]

    return StreamingResponse(generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@events_router.get("/stream", summary="Live SSE stream of the user's task/approval/notification events",
                   response_class=StreamingResponse)
async def user_stream(request: Request, db: DbSession, ctx: RequestContext = Depends(get_stream_ctx)
                      ) -> StreamingResponse:
    await db.commit()

    async def generator() -> AsyncIterator[str]:
        sub = get_event_bus().subscribe(user_channel(ctx.user_id))
        try:
            yield ": connected\n\n"
            while not await request.is_disconnected():
                try:
                    message = await asyncio.wait_for(sub.__anext__(), timeout=15.0)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                if message.get("type") == "__idle__":
                    continue
                yield _sse(str(message.get("type", "event")), message)
        finally:
            with contextlib.suppress(Exception):
                await sub.aclose()  # type: ignore[attr-defined]

    return StreamingResponse(generator(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
