"""files service: upload, access control, signed downloads, deletion and retention.

Transaction discipline: bytes are sniffed, scanned and written to object storage
*before* the database transaction that records them; object deletion happens
*after* the transaction that marks a file deleted (plus a durable
``file.delete_objects`` job, so a crash between the two can never leave a
readable orphan behind).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any, Protocol

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.service import AuditCategory, record
from app.common.context import RequestContext
from app.common.ids import new_id
from app.common.pagination import Page, apply_keyset, build_page, clamp_limit
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.exceptions import NotFound, PayloadTooLarge, ServiceUnavailable, ValidationFailed
from app.files.models import ExtractionStatus, File, FileMetadata, FilePurpose, FileStatus
from app.files.processing import TEXT_TYPES, WRITABLE_TEXT_TYPES, reconstruct_text, sniff_content_type
from app.files.scanning import MalwareScanner, ScanStatus, get_scanner
from app.files.schemas import DownloadUrlOut, FileOut
from app.files.storage import ObjectStorage, get_storage, object_key_for, sanitize_filename
from app.search import service as search_service
from app.search.models import SourceType
from app.usage.models import UsageKind
from app.usage.service import add_usage
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

logger = logging.getLogger(__name__)

PROCESS_FILE_JOB = "file.process"
DELETE_OBJECTS_JOB = "file.delete_objects"
PURGE_EXPIRED_JOB = "file.purge_expired"
_UPLOAD_CHUNK = 1024 * 1024
_DELETE_BATCH = 200
MAX_DOWNLOAD_URL_TTL = 3600


class AsyncReadable(Protocol):
    async def read(self, size: int = -1) -> bytes: ...


# ---------------------------------------------------------------------------- helpers
def expiry_for(purpose: str, now: datetime | None = None) -> datetime | None:
    settings = get_settings()
    now = now or utcnow()
    if purpose == FilePurpose.TEMP:
        return now + timedelta(days=settings.retention_temp_files_days)
    if purpose == FilePurpose.BROWSER_ARTIFACT:
        return now + timedelta(days=settings.retention_browser_artifacts_days)
    return None


async def read_upload(upload: AsyncReadable, max_bytes: int, *, declared_size: int | None = None) -> bytes:
    """Stream an upload into memory, refusing as soon as it exceeds ``max_bytes``."""
    if declared_size is not None and declared_size > max_bytes:
        raise PayloadTooLarge("The file exceeds the maximum upload size.", details={"max_bytes": max_bytes})
    buf = bytearray()
    while True:
        chunk = await upload.read(_UPLOAD_CHUNK)
        if not chunk:
            break
        buf.extend(chunk)
        if len(buf) > max_bytes:
            raise PayloadTooLarge("The file exceeds the maximum upload size.",
                                  details={"max_bytes": max_bytes})
    return bytes(buf)


async def _safe_delete_object(storage: ObjectStorage, key: str) -> None:
    try:
        await storage.delete(key)
    except Exception as exc:  # the durable delete job retries; never mask the caller's outcome
        logger.warning("object delete failed; deferred to job", extra={"error": type(exc).__name__})


async def _enqueue_object_deletion(session: AsyncSession, tenant_id: uuid.UUID, keys: Sequence[str]) -> None:
    queue = get_job_queue()
    for offset in range(0, len(keys), _DELETE_BATCH):
        batch = list(keys[offset:offset + _DELETE_BATCH])
        await queue.enqueue(session, JobSpec(
            queue=Queues.FILES, job_type=DELETE_OBJECTS_JOB, tenant_id=tenant_id,
            payload={"tenant_id": str(tenant_id), "keys": batch},
        ))


async def enqueue_processing(session: AsyncSession, tenant_id: uuid.UUID, file_id: uuid.UUID) -> None:
    await get_job_queue().enqueue(session, JobSpec(
        queue=Queues.FILES, job_type=PROCESS_FILE_JOB, tenant_id=tenant_id,
        payload={"tenant_id": str(tenant_id), "file_id": str(file_id)}, dedupe_key=f"file.process:{file_id}",
    ))


# ---------------------------------------------------------------------------- upload
async def upload_file(
    session: AsyncSession,
    ctx: RequestContext,
    *,
    data: bytes,
    filename: str | None,
    purpose: str = FilePurpose.USER_UPLOAD,
    storage: ObjectStorage | None = None,
    scanner: MalwareScanner | None = None,
    file_id: uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    preferred_text_type: str | None = None,
    delete_object_on_failure: bool = True,
) -> File:
    """Validate, scan, store and record a new file, then enqueue ``file.process``.

    The content type is sniffed from the bytes. ``preferred_text_type`` may only pick a
    text subtype (plain/markdown/csv) for content already sniffed as text. Callers must
    not hold an open transaction on ``session`` (scan + storage IO happen first)."""
    settings = get_settings()
    storage = storage or get_storage()
    scanner = scanner or get_scanner()
    if purpose not in FilePurpose.ALL:
        raise ValidationFailed("Unknown file purpose.", details={"purpose": purpose})
    if not data:
        raise ValidationFailed("The file is empty.", code="empty_file")
    if len(data) > settings.file_max_upload_bytes:
        raise PayloadTooLarge("The file exceeds the maximum upload size.",
                              details={"max_bytes": settings.file_max_upload_bytes})
    content_type = await asyncio.to_thread(sniff_content_type, data, filename_hint=filename)
    if preferred_text_type is not None:
        if preferred_text_type not in WRITABLE_TEXT_TYPES or content_type not in TEXT_TYPES:
            raise ValidationFailed("The content does not match the requested text format.",
                                   code="unsupported_file_type")
        content_type = preferred_text_type
    sha256 = hashlib.sha256(data).hexdigest()
    file_id = file_id or new_id()
    key = object_key_for(ctx.tenant_id, file_id)
    display_name = sanitize_filename(filename)
    now = utcnow()

    scan = await scanner.scan(data)
    if scan.status == ScanStatus.ERROR:
        raise ServiceUnavailable("Malware scanning is temporarily unavailable. Please retry.",
                                 code="scan_unavailable")
    base = {
        "id": file_id, "tenant_id": ctx.tenant_id, "user_id": ctx.user_id, "task_id": task_id,
        "filename": display_name, "object_key": key, "content_type": content_type, "size_bytes": len(data),
        "sha256": sha256, "scan_status": scan.status, "purpose": purpose, "created_at": now,
        "updated_at": now,
    }
    if scan.is_infected:
        session.add(File(**base, status=FileStatus.QUARANTINED, scan_signature=scan.signature,
                         error="rejected by malware scanner"))
        record(session, ctx=ctx, category=AuditCategory.SECURITY, action="file.malware_detected",
               status="blocked", resource_type="file", resource_id=file_id,
               metadata={"signature": scan.signature, "scanner": scan.scanner, "sha256": sha256,
                         "size_bytes": len(data), "content_type": content_type})
        await session.commit()
        await _safe_delete_object(storage, key)
        raise ValidationFailed("The file was rejected by the malware scanner.", code="malware_detected",
                               details={"file_id": str(file_id)})

    await storage.put_bytes(key, data, content_type)
    try:
        file = File(**base, status=FileStatus.UPLOADED, expires_at=expiry_for(purpose, now))
        session.add(file)
        session.add(FileMetadata(tenant_id=ctx.tenant_id, file_id=file_id,
                                 extraction_status=ExtractionStatus.PENDING, extra={}, created_at=now,
                                 updated_at=now))
        add_usage(session, tenant_id=ctx.tenant_id, user_id=ctx.user_id, task_id=task_id,
                  kind=UsageKind.STORAGE_BYTES, quantity=float(len(data)), unit="bytes",
                  metadata={"file_id": str(file_id), "content_type": content_type})
        record(session, ctx=ctx, category=AuditCategory.DATA, action="file.uploaded", resource_type="file",
               resource_id=file_id, task_id=task_id,
               metadata={"content_type": content_type, "size_bytes": len(data), "sha256": sha256,
                         "purpose": purpose, "scan_status": scan.status})
        await enqueue_processing(session, ctx.tenant_id, file_id)
        await session.commit()
    except BaseException:
        await session.rollback()
        if delete_object_on_failure:
            await _safe_delete_object(storage, key)
        raise
    return file


# ---------------------------------------------------------------------------- read access
async def get_file_for(session: AsyncSession, ctx: RequestContext, file_id: uuid.UUID, *,
                       for_update: bool = False) -> File:
    """Load a live file owned by the caller. Other tenants' and other users' files are
    reported as not found so their existence does not leak."""
    stmt = select(File).where(File.id == file_id, File.tenant_id == ctx.tenant_id,
                              File.user_id == ctx.user_id, File.deleted_at.is_(None))
    if for_update:
        stmt = stmt.with_for_update()
    file = (await session.execute(stmt)).scalar_one_or_none()
    if file is None:
        raise NotFound("File not found.")
    return file


async def get_file_detail(session: AsyncSession, ctx: RequestContext, file_id: uuid.UUID
                          ) -> tuple[File, FileMetadata | None]:
    file = await get_file_for(session, ctx, file_id)
    meta = (await session.execute(select(FileMetadata).where(FileMetadata.file_id == file.id))
            ).scalar_one_or_none()
    return file, meta


async def list_files(session: AsyncSession, ctx: RequestContext, *, cursor: str | None = None,
                     limit: int | None = None, purpose: str | None = None,
                     status: str | None = None) -> Page[FileOut]:
    """The caller's own live files, newest first (keyset pagination)."""
    lim = clamp_limit(limit)
    stmt = select(File).where(File.tenant_id == ctx.tenant_id, File.user_id == ctx.user_id,
                              File.deleted_at.is_(None))
    if purpose:
        stmt = stmt.where(File.purpose == purpose)
    if status:
        stmt = stmt.where(File.status == status)
    rows = list((await session.execute(apply_keyset(stmt, File, cursor, lim))).scalars().all())
    return build_page(rows, lim, FileOut.from_model)


async def get_download_url(session: AsyncSession, ctx: RequestContext, file_id: uuid.UUID, *,
                           storage: ObjectStorage | None = None) -> DownloadUrlOut:
    storage = storage or get_storage()
    file = await get_file_for(session, ctx, file_id)
    if file.status not in FileStatus.READABLE:
        raise NotFound("File not found.")
    ttl = max(1, min(get_settings().signed_url_ttl_seconds, MAX_DOWNLOAD_URL_TTL))
    key, filename = file.object_key, file.filename
    await session.commit()  # end the read transaction before any storage IO (S3 presigning)
    url = await storage.signed_download_url(key, filename=filename, ttl_seconds=ttl)
    return DownloadUrlOut(url=url, expires_at=utcnow() + timedelta(seconds=ttl), filename=filename)


async def resolve_download(session: AsyncSession, key: str) -> File:
    """For the signed local download endpoint: the object must still belong to a live file.
    ``session`` must be scoped to the tenant encoded in the (signed) key."""
    file = (await session.execute(select(File).where(File.object_key == key, File.deleted_at.is_(None))
                                  )).scalar_one_or_none()
    if file is None or file.status not in FileStatus.READABLE:
        raise NotFound("File not found.")
    return file


async def read_file_text(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID,
                         file_id: uuid.UUID, offset: int = 0, max_chars: int = 20_000) -> dict[str, Any]:
    """Extracted text of one of the user's files, reconstructed from its indexed chunks."""
    file = (await session.execute(select(File).where(
        File.id == file_id, File.tenant_id == tenant_id, File.user_id == user_id, File.deleted_at.is_(None))
    )).scalar_one_or_none()
    if file is None:
        raise NotFound("File not found.")
    chunks = await search_service.load_document_chunks(session, tenant_id=tenant_id,
                                                       source_type=SourceType.FILE, source_id=str(file.id))
    text = reconstruct_text(chunks)
    offset = max(0, offset)
    window = text[offset:offset + max_chars]
    end = offset + len(window)
    return {
        "file_id": file.id, "filename": file.filename, "content_type": file.content_type,
        "status": file.status, "text": window, "offset": offset, "total_chars": len(text),
        "truncated": end < len(text),
        "next_offset": end if end < len(text) else None,
    }


# ---------------------------------------------------------------------------- deletion & retention
async def _remove_derived_data(session: AsyncSession, tenant_id: uuid.UUID, file_ids: Sequence[uuid.UUID]
                               ) -> None:
    ids = list(file_ids)
    if not ids:
        return
    await search_service.delete_documents_for_sources(session, tenant_id=tenant_id,
                                                      source_type=SourceType.FILE,
                                                      source_ids=[str(i) for i in ids])
    await session.execute(delete(FileMetadata).where(FileMetadata.tenant_id == tenant_id,
                                                     FileMetadata.file_id.in_(ids)))


def _meter_release(session: AsyncSession, file: File) -> None:
    if file.status != FileStatus.QUARANTINED:
        add_usage(session, tenant_id=file.tenant_id, user_id=file.user_id, kind=UsageKind.STORAGE_BYTES,
                  quantity=-float(file.size_bytes), unit="bytes", metadata={"file_id": str(file.id),
                                                                            "reason": "deleted"})


async def delete_file(session: AsyncSession, ctx: RequestContext, file_id: uuid.UUID, *,
                      storage: ObjectStorage | None = None) -> None:
    """Soft-delete the row, remove derived search documents/chunks/embeddings and the
    extracted metadata, then delete the stored object (durably via a job)."""
    storage = storage or get_storage()
    file = await get_file_for(session, ctx, file_id, for_update=True)
    key = file.object_key
    _meter_release(session, file)
    file.status = FileStatus.DELETED
    file.deleted_at = utcnow()
    await _remove_derived_data(session, ctx.tenant_id, [file.id])
    record(session, ctx=ctx, category=AuditCategory.DATA, action="file.deleted", resource_type="file",
           resource_id=file.id, metadata={"owner_user_id": str(file.user_id), "size_bytes": file.size_bytes})
    await _enqueue_object_deletion(session, ctx.tenant_id, [key])
    await session.commit()
    await _safe_delete_object(storage, key)


async def purge_user_files(session: AsyncSession, tenant_id: uuid.UUID, user_id: uuid.UUID) -> int:
    """Account deletion: hard-delete all of a user's files in a tenant, their derived search
    data and the user's other search documents, and enqueue durable object deletion.
    Runs in the caller's transaction (no commit, no storage IO here)."""
    files = list((await session.execute(
        select(File).where(File.tenant_id == tenant_id, File.user_id == user_id).with_for_update()
    )).scalars().all())
    await _remove_derived_data(session, tenant_id, [f.id for f in files])
    await search_service.delete_user_documents(session, tenant_id=tenant_id, user_id=user_id)
    for file in files:
        if file.deleted_at is None:
            _meter_release(session, file)
    await session.execute(delete(File).where(File.tenant_id == tenant_id, File.user_id == user_id))
    await _enqueue_object_deletion(session, tenant_id, [f.object_key for f in files])
    if files:
        record(session, tenant_id=tenant_id, user_id=user_id, actor_type="system",
               category=AuditCategory.DATA, action="file.user_files_purged", resource_type="user",
               resource_id=user_id,
               metadata={"count": len(files)})
    return len(files)


async def purge_expired_files(session: AsyncSession, now: datetime | None = None, *,
                              batch_size: int = 500) -> int:
    """Retention: soft-delete files past ``expires_at`` (across tenants on a system session),
    drop their derived data and enqueue object deletion. The caller commits."""
    now = now or utcnow()
    files = list((await session.execute(
        select(File)
        .where(File.expires_at.is_not(None), File.expires_at <= now, File.deleted_at.is_(None))
        .order_by(File.expires_at)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )).scalars().all())
    by_tenant: dict[uuid.UUID, list[File]] = {}
    for file in files:
        by_tenant.setdefault(file.tenant_id, []).append(file)
    for tenant_id, tenant_files in by_tenant.items():
        for file in tenant_files:
            _meter_release(session, file)
            file.status = FileStatus.DELETED
            file.deleted_at = now
        await _remove_derived_data(session, tenant_id, [f.id for f in tenant_files])
        await _enqueue_object_deletion(session, tenant_id, [f.object_key for f in tenant_files])
        record(session, tenant_id=tenant_id, actor_type="system", category=AuditCategory.DATA,
               action="file.retention_purged", metadata={"count": len(tenant_files)})
    return len(files)
