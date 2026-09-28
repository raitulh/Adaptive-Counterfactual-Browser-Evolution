"""The ``file.process`` pipeline, deletion of derived data, and retention/account purges."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta
from typing import Any

import pytest
from files_fixtures import ApiUser, ControlledScanner
from files_samples import PNG_BYTES, XXE_DOCUMENT_XML, make_docx, make_xlsx
from sqlalchemy import select, update

from app.common.time import utcnow
from app.core.database import get_session_factory
from app.files import service
from app.files.models import File, FileMetadata, FilePurpose, FileStatus
from app.files.processing import process_file
from app.files.storage import LocalFilesystemStorage
from app.model_gateway.router import ModelRouter, set_model_router
from app.search import service as search_service
from app.search.models import SearchChunk, SearchDocument, SourceType
from app.workers.queues.models import Job

pytestmark = pytest.mark.integration

Register = Callable[[], Awaitable[ApiUser]]
RunJob = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


async def _upload(user: ApiUser, data: bytes, *, filename: str = "doc", purpose: str = FilePurpose.USER_UPLOAD,
                  storage: LocalFilesystemStorage) -> File:
    async with get_session_factory()() as session:
        session.info["tenant_id"] = user.tenant_id
        return await service.upload_file(session, user.ctx(), data=data, filename=filename, purpose=purpose,
                                         storage=storage)


async def _one(stmt: Any) -> Any:
    async with get_session_factory()() as session:
        session.info["system"] = True
        return (await session.execute(stmt)).scalar_one_or_none()


async def _all(stmt: Any) -> list[Any]:
    async with get_session_factory()() as session:
        session.info["system"] = True
        return list((await session.execute(stmt)).scalars().all())


async def _chunks_for(file_id: uuid.UUID) -> list[SearchChunk]:
    return await _all(select(SearchChunk).join(SearchDocument, SearchDocument.id == SearchChunk.document_id)
                      .where(SearchDocument.source_type == SourceType.FILE,
                             SearchDocument.source_id == str(file_id)).order_by(SearchChunk.chunk_index))


async def test_docx_and_xlsx_are_indexed_idempotently(register: Register, storage: LocalFilesystemStorage,
                                                      scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user = await register()
    paragraphs = [f"Section {i}: the aurora borealis observation log entry {i}. " * 8 for i in range(12)]
    docx = await _upload(user, make_docx(paragraphs), filename="log.docx", storage=storage)
    assert docx.content_type.endswith("wordprocessingml.document")
    await run_process_job(user.tenant_id, docx.id)
    first = await _chunks_for(docx.id)
    assert len(first) > 1
    assert "aurora borealis" in first[0].content and "\t" not in first[0].content
    await run_process_job(user.tenant_id, docx.id)  # at-least-once delivery: re-running is harmless
    second = await _chunks_for(docx.id)
    assert [c.content for c in second] == [c.content for c in first]
    meta = await _one(select(FileMetadata).where(FileMetadata.file_id == docx.id))
    assert meta.chunk_count == len(second) and meta.extra["embedded_chunks"] == len(second)

    xlsx = await _upload(user, make_xlsx([["city", "population"], ["Oslo", "700000"]]), storage=storage)
    await run_process_job(user.tenant_id, xlsx.id)
    assert "Oslo | 700000" in (await _chunks_for(xlsx.id))[0].content


async def test_xxe_docx_fails_safely(register: Register, storage: LocalFilesystemStorage,
                                     scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user = await register()
    file = await _upload(user, make_docx(document_xml=XXE_DOCUMENT_XML), filename="evil.docx", storage=storage)
    await run_process_job(user.tenant_id, file.id)
    row = await _one(select(File).where(File.id == file.id))
    meta = await _one(select(FileMetadata).where(FileMetadata.file_id == file.id))
    assert row.status == FileStatus.FAILED and row.error.startswith("unsafe_document")
    assert meta.extraction_status == "failed"
    assert await _chunks_for(file.id) == []


async def test_images_are_stored_but_not_indexed(register: Register, storage: LocalFilesystemStorage,
                                                 scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user = await register()
    file = await _upload(user, PNG_BYTES, filename="pixel.png", storage=storage)
    assert file.content_type == "image/png"
    await run_process_job(user.tenant_id, file.id)
    meta = await _one(select(FileMetadata).where(FileMetadata.file_id == file.id))
    assert meta.extraction_status == "skipped" and meta.chunk_count == 0
    assert (await _one(select(File).where(File.id == file.id))).status == FileStatus.READY


class _FailingEmbeddings:
    name = "failing"

    async def embed(self, texts: list[str], **kwargs: Any) -> list[list[float]]:
        raise RuntimeError("embedding backend down")


async def test_embedding_outage_degrades_to_keyword_index(register: Register, storage: LocalFilesystemStorage,
                                                          scanner: ControlledScanner) -> None:
    user = await register()
    file = await _upload(user, b"Keyword only indexing still works for glacier research.", storage=storage)
    router = ModelRouter(_FailingEmbeddings(), usage_sink=None)  # type: ignore[arg-type]
    status = await process_file(get_session_factory(), tenant_id=user.tenant_id, file_id=file.id,
                                storage=storage, model_router=router)
    assert status == FileStatus.READY
    chunks = await _chunks_for(file.id)
    assert chunks and all(c.embedding is None for c in chunks)
    async with get_session_factory()() as session:
        session.info["tenant_id"] = user.tenant_id
        found = await search_service.search_documents(session, tenant_id=user.tenant_id, user_id=user.user_id,
                                                      query="glacier research", model_router=router)
    assert found.results and not found.used_vector_search
    set_model_router(None)


async def test_missing_object_and_deleted_file(register: Register, storage: LocalFilesystemStorage,
                                               scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user = await register()
    lost = await _upload(user, b"this object will vanish", storage=storage)
    await storage.delete(lost.object_key)
    await run_process_job(user.tenant_id, lost.id)
    row = await _one(select(File).where(File.id == lost.id))
    assert row.status == FileStatus.FAILED and "missing" in row.error

    gone = await _upload(user, b"deleted before processing", storage=storage)
    async with get_session_factory()() as session:
        session.info["tenant_id"] = user.tenant_id
        await service.delete_file(session, user.ctx(), gone.id, storage=storage)
    status = await process_file(get_session_factory(), tenant_id=user.tenant_id, file_id=gone.id, storage=storage)
    assert status == FileStatus.DELETED
    assert await _chunks_for(gone.id) == []


async def test_purge_expired_files(register: Register, storage: LocalFilesystemStorage,
                                   scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user = await register()
    temp = await _upload(user, b"temporary scratch notes about volcanoes", purpose=FilePurpose.TEMP,
                         storage=storage)
    keep = await _upload(user, b"permanent notes", storage=storage)
    assert temp.expires_at is not None and keep.expires_at is None
    await run_process_job(user.tenant_id, temp.id)
    assert await _chunks_for(temp.id)
    async with get_session_factory()() as session:
        session.info["system"] = True
        await session.execute(update(File).where(File.id == temp.id)
                              .values(expires_at=utcnow() - timedelta(minutes=1)))
        await session.commit()
    async with get_session_factory()() as session:
        session.info["system"] = True
        purged = await service.purge_expired_files(session, utcnow())
        await session.commit()
    assert purged >= 1
    row = await _one(select(File).where(File.id == temp.id))
    assert row.deleted_at is not None and row.status == FileStatus.DELETED
    assert (await _one(select(File).where(File.id == keep.id))).deleted_at is None
    assert await _chunks_for(temp.id) == []
    jobs = await _all(select(Job).where(Job.job_type == "file.delete_objects", Job.tenant_id == user.tenant_id))
    assert any(temp.object_key in job.payload["keys"] for job in jobs)

    # The durable delete job removes the bytes, and only inside the job's tenant namespace.
    from app.files.jobs import delete_objects_job
    from app.workers.jobs.registry import JobContext
    from app.workers.queues.base import ClaimedJob

    foreign = f"tenants/{uuid.uuid4()}/files/{uuid.uuid4()}"
    await storage.put_bytes(foreign, b"other tenant", "text/plain")
    payload = {"tenant_id": str(user.tenant_id), "keys": [temp.object_key, foreign, "../escape"]}
    job = ClaimedJob(id=uuid.uuid4(), queue="files", job_type="file.delete_objects", payload=payload,
                     attempts=1, max_attempts=5, tenant_id=user.tenant_id)
    await delete_objects_job(JobContext(job=job, worker_id="w", session_factory=get_session_factory()), payload)
    assert not await storage.exists(temp.object_key)
    assert await storage.exists(foreign)


async def test_purge_user_files(register: Register, storage: LocalFilesystemStorage,
                                scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user, other = await register(), await register()
    files = [await _upload(user, f"user document {i} about tundra".encode(), storage=storage) for i in range(2)]
    other_file = await _upload(other, b"other user's document about tundra", storage=storage)
    for file in files:
        await run_process_job(user.tenant_id, file.id)
    await run_process_job(other.tenant_id, other_file.id)
    async with get_session_factory()() as session:
        session.info["tenant_id"] = user.tenant_id
        purged = await service.purge_user_files(session, user.tenant_id, user.user_id)
        await session.commit()
    assert purged == 2
    assert await _all(select(File).where(File.user_id == user.user_id)) == []
    assert await _all(select(FileMetadata).where(FileMetadata.tenant_id == user.tenant_id)) == []
    assert await _all(select(SearchDocument).where(SearchDocument.user_id == user.user_id)) == []
    jobs = await _all(select(Job).where(Job.job_type == "file.delete_objects", Job.tenant_id == user.tenant_id))
    assert sorted(k for j in jobs for k in j.payload["keys"]) == sorted(f.object_key for f in files)
    assert await _chunks_for(other_file.id), "other tenants are untouched"
