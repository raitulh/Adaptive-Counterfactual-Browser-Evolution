"""files background jobs (idempotent; at-least-once delivery)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.core.exceptions import IntegrationError, ServiceUnavailable
from app.files.processing import process_file
from app.files.service import DELETE_OBJECTS_JOB, PROCESS_FILE_JOB, PURGE_EXPIRED_JOB, purge_expired_files
from app.files.storage import get_storage, tenant_prefix
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import PermanentJobFailure, RetryJob

logger = logging.getLogger(__name__)


def _uuid(payload: dict[str, Any], key: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(payload[key]))
    except (KeyError, ValueError) as exc:
        raise PermanentJobFailure(f"invalid payload field {key}") from exc


@job(PROCESS_FILE_JOB)
async def process_file_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    from app.model_gateway.router import get_model_router

    tenant_id, file_id = _uuid(payload, "tenant_id"), _uuid(payload, "file_id")
    try:
        status = await process_file(ctx.session_factory, tenant_id=tenant_id, file_id=file_id,
                                    storage=get_storage(), model_router=get_model_router())
    except (IntegrationError, ServiceUnavailable, OSError) as exc:
        raise RetryJob(f"file processing dependency unavailable: {type(exc).__name__}",
                       delay_seconds=30) from exc
    logger.info("file processed", extra={"file_id": str(file_id), "status": status})


@job(DELETE_OBJECTS_JOB)
async def delete_objects_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    tenant_id = _uuid(payload, "tenant_id")
    prefix = tenant_prefix(tenant_id)
    storage = get_storage()
    keys = payload.get("keys") or []
    for key in keys:
        # Only keys inside the job's own tenant namespace are ever deleted.
        if not isinstance(key, str) or not key.startswith(prefix):
            logger.error("refusing to delete object outside tenant prefix",
                         extra={"tenant_id": str(tenant_id)})
            continue
        try:
            await storage.delete(key)
        except (IntegrationError, OSError) as exc:
            raise RetryJob(f"object delete failed: {type(exc).__name__}", delay_seconds=30) from exc


@job(PURGE_EXPIRED_JOB)
async def purge_expired_job(ctx: JobContext, payload: dict[str, Any]) -> None:
    batch_size = int(payload.get("batch_size") or 500)
    async with ctx.session_factory() as session:
        session.info["system"] = True
        count = await purge_expired_files(session, batch_size=max(1, min(batch_size, 5000)))
        await session.commit()
    if count:
        logger.info("expired files purged", extra={"count": count})
