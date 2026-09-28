from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFound
from app.tasks.models import Task, TaskDependency, TaskStep


async def lock_task(session: AsyncSession, task_id: uuid.UUID) -> Task:
    """Row-lock the task for the rest of the transaction and refresh its state.
    All task state transitions happen under this lock."""
    task = (await session.execute(
        select(Task).where(Task.id == task_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if task is None:
        raise NotFound("Task not found")
    return task


async def get_task(session: AsyncSession, task_id: uuid.UUID) -> Task:
    task = await session.get(Task, task_id)
    if task is None:
        raise NotFound("Task not found")
    return task


async def lock_step(session: AsyncSession, step_id: uuid.UUID) -> TaskStep:
    step = (await session.execute(
        select(TaskStep).where(TaskStep.id == step_id).with_for_update().execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if step is None:
        raise NotFound("Step not found")
    return step


async def current_steps(session: AsyncSession, task: Task, *, lock: bool = False) -> list[TaskStep]:
    stmt = (select(TaskStep).where(TaskStep.task_id == task.id, TaskStep.plan_version == task.plan_version)
            .order_by(TaskStep.position))
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    else:
        stmt = stmt.execution_options(populate_existing=True)
    return list((await session.execute(stmt)).scalars().all())


async def all_steps(session: AsyncSession, task_id: uuid.UUID) -> list[TaskStep]:
    return list((await session.execute(
        select(TaskStep).where(TaskStep.task_id == task_id).order_by(TaskStep.plan_version, TaskStep.position)
        .execution_options(populate_existing=True)
    )).scalars().all())


async def dependency_map(session: AsyncSession, task: Task) -> dict[uuid.UUID, set[uuid.UUID]]:
    rows = (await session.execute(
        select(TaskDependency.step_id, TaskDependency.depends_on_step_id).where(TaskDependency.task_id == task.id)
    )).all()
    out: dict[uuid.UUID, set[uuid.UUID]] = {}
    for step_id, dep in rows:
        out.setdefault(step_id, set()).add(dep)
    return out


def step_outputs_by_key(steps: list[TaskStep]) -> dict[str, dict[str, Any]]:
    return {s.step_key: s.output or {} for s in steps if s.status == "completed" and s.output is not None}
