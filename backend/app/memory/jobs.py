"""Memory background jobs (idempotent, at-least-once).

* ``memory.embed``         — compute and upsert the embedding of one memory.
* ``memory.extract``       — extract memories from a finished task.
* ``memory.purge_deleted`` — hard-delete soft-deleted memories past the retention window.
"""

from __future__ import annotations

import logging
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import select

from app.common.feature_flags import Flags, is_enabled
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.exceptions import (
    ModelError,
    ModelOutputInvalid,
    ModelRateLimited,
    ModelTimeout,
    ModelUnavailable,
)
from app.memory.models import EMBEDDING_DIM, MemoryItem, MemoryStatus
from app.memory.service import extract_memories_from_task, get_vector_index, purge_deleted_memories
from app.model_gateway.router import ModelRouter, get_model_router
from app.model_gateway.types import CallMetadata
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import PermanentJobFailure, RetryJob

logger = logging.getLogger(__name__)

_TRANSIENT_MODEL_ERRORS = (ModelUnavailable, ModelTimeout, ModelRateLimited)
# Deleted memories must never regain derived data; superseded ones are never retrieved again.
_NOT_EMBEDDABLE = (MemoryStatus.DELETED.value, MemoryStatus.SUPERSEDED.value)


def _embedding_model_name(router: ModelRouter) -> str:
    if router.provider.name == "gemini":
        return router.settings.gemini_embedding_model
    return router.provider.name


def _uuid(payload: dict[str, Any], key: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(payload[key]))
    except (KeyError, ValueError) as exc:
        raise PermanentJobFailure(f"invalid payload: {key}") from exc


@job("memory.embed")
async def embed_memory(ctx: JobContext, payload: dict[str, Any]) -> None:
    tenant_id, memory_id = _uuid(payload, "tenant_id"), _uuid(payload, "memory_id")

    async with ctx.session_factory() as session:
        session.info["tenant_id"] = tenant_id
        item = await session.get(MemoryItem, memory_id)
        if item is None or item.status in _NOT_EMBEDDABLE:
            return
        content, digest = item.content, item.content_hash
        await session.rollback()  # no transaction across the model call

    router = get_model_router()
    try:
        vectors = await router.embed([content], task_type="RETRIEVAL_DOCUMENT",
                                     metadata=CallMetadata(purpose="memory_embedding", tenant_id=tenant_id))
    except _TRANSIENT_MODEL_ERRORS as exc:
        raise RetryJob(f"embedding unavailable: {type(exc).__name__}",
                       delay_seconds=30.0 * ctx.attempt) from exc
    except ModelError as exc:
        raise PermanentJobFailure(f"embedding failed: {exc.code}") from exc
    vector = [float(v) for v in vectors[0]] if vectors else []
    if len(vector) != EMBEDDING_DIM:
        raise PermanentJobFailure(f"embedding has {len(vector)} dimensions, expected {EMBEDDING_DIM}")
    if not any(vector):
        logger.info("memory has no embeddable content", extra={"memory_id": str(memory_id)})
        return

    async with ctx.session_factory() as session:
        session.info["tenant_id"] = tenant_id
        # Row lock: a concurrent delete either finishes first (we skip) or waits and removes our row.
        current = (await session.execute(
            select(MemoryItem).where(MemoryItem.id == memory_id).with_for_update()
        )).scalar_one_or_none()
        if current is None or current.status in _NOT_EMBEDDABLE or current.content_hash != digest:
            await session.rollback()
            return
        await get_vector_index().upsert(session, tenant_id=tenant_id, memory_id=memory_id, vector=vector,
                                        model=_embedding_model_name(router))
        await session.commit()


@job("memory.extract")
async def extract_memories(ctx: JobContext, payload: dict[str, Any]) -> None:
    tenant_id, task_id = _uuid(payload, "tenant_id"), _uuid(payload, "task_id")
    async with ctx.session_factory() as session:
        session.info["tenant_id"] = tenant_id
        if not await is_enabled(session, Flags.MEMORY_EXTRACTION, tenant_id):
            return
        try:
            stored = await extract_memories_from_task(session, task_id=task_id,
                                                      model_router=get_model_router())
        except _TRANSIENT_MODEL_ERRORS as exc:
            raise RetryJob(f"model unavailable: {type(exc).__name__}",
                           delay_seconds=60.0 * ctx.attempt) from exc
        except ModelOutputInvalid:
            logger.warning("memory extraction output invalid; skipping task", extra={"task_id": str(task_id)})
            return
        except ModelError as exc:
            raise PermanentJobFailure(f"memory extraction failed: {exc.code}") from exc
    logger.info("memory extraction finished", extra={"task_id": str(task_id), "stored": stored})


@job("memory.purge_deleted")
async def purge_deleted(ctx: JobContext, payload: dict[str, Any]) -> None:
    """Scheduled maintenance: hard-delete memories soft-deleted (or expired) longer ago than
    ``settings.retention_deleted_memory_days``."""
    days = max(0, int(get_settings().retention_deleted_memory_days))
    async with ctx.session_factory() as session:
        session.info["system"] = True  # cross-tenant maintenance
        purged = await purge_deleted_memories(session, older_than=utcnow() - timedelta(days=days))
        await session.commit()
    logger.info("purged deleted memories", extra={"count": purged, "retention_days": days})
