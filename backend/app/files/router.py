"""files API."""

from __future__ import annotations

import hashlib
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Form, Query, Response, UploadFile, status
from fastapi import File as FileParam
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.dependencies import DbSession, IdempotencyKeyHeader, require
from app.common.context import RequestContext
from app.common.idempotency import run_idempotent
from app.common.pagination import Page
from app.core.config import get_settings
from app.core.database import get_session_factory, set_tenant_scope
from app.core.exceptions import NotFound
from app.files import service
from app.files.schemas import DownloadUrlOut, FileOut
from app.files.storage import (
    LocalFilesystemStorage,
    content_disposition,
    get_storage,
    tenant_id_from_key,
    verify_download_token,
)
from app.organizations.rbac import P

router = APIRouter(prefix="/files", tags=["files"])

ReadCtx = Annotated[RequestContext, Depends(require(P.FILES_READ))]
WriteCtx = Annotated[RequestContext, Depends(require(P.FILES_WRITE))]


@router.post("", status_code=status.HTTP_201_CREATED, response_model=FileOut, summary="Upload a file",
             responses={413: {"description": "File too large"},
                        422: {"description": "Unsupported file type, empty file or malware detected"},
                        503: {"description": "Malware scanning unavailable"}})
async def upload_file(
    ctx: WriteCtx,
    db: DbSession,
    file: Annotated[UploadFile, FileParam(description="The file to upload")],
    purpose: Annotated[Literal["user_upload", "temp"], Form()] = "user_upload",
    idempotency_key: IdempotencyKeyHeader = None,
) -> JSONResponse:
    settings = get_settings()
    data = await service.read_upload(file, settings.file_max_upload_bytes, declared_size=file.size)
    # End the authentication read transaction: scanning and storage IO follow.
    await db.commit()
    fingerprint = {"sha256": hashlib.sha256(data).hexdigest(), "filename": file.filename, "purpose": purpose}

    async def handler() -> tuple[int, FileOut]:
        created = await service.upload_file(db, ctx, data=data, filename=file.filename, purpose=purpose)
        return status.HTTP_201_CREATED, FileOut.from_model(created)

    result = await run_idempotent(ctx, idempotency_key, "POST", "/files", fingerprint, handler)
    headers = {"Idempotent-Replayed": "true"} if result.replayed else None
    return JSONResponse(result.body, status_code=result.status_code, headers=headers)


@router.get("", response_model=Page[FileOut], summary="List your files")
async def list_files(
    ctx: ReadCtx,
    db: DbSession,
    cursor: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    purpose: Literal["user_upload", "task_artifact", "browser_artifact", "temp"] | None = None,
    file_status: Literal["uploaded", "processing", "ready", "quarantined", "failed"] | None = Query(
        None, alias="status"),
) -> Page[FileOut]:
    return await service.list_files(db, ctx, cursor=cursor, limit=limit, purpose=purpose, status=file_status)


@router.get("/download", summary="Download a file via a signed link (local storage backend)",
            response_class=StreamingResponse,
            responses={200: {"content": {"application/octet-stream": {}}},
                       403: {"description": "Invalid or expired link"}})
async def download(token: Annotated[str, Query(min_length=10, max_length=4096)]) -> StreamingResponse:
    storage = get_storage()
    if not isinstance(storage, LocalFilesystemStorage):
        raise NotFound("Not found.")
    key, filename = verify_download_token(token)
    tenant_id = tenant_id_from_key(key)
    async with get_session_factory()() as session:
        set_tenant_scope(session, tenant_id)
        await service.resolve_download(session, key)
    if not await storage.exists(key):
        raise NotFound("File not found.")
    headers = {
        "Content-Disposition": content_disposition(filename),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "default-src 'none'; sandbox",
    }
    return StreamingResponse(storage.iter_bytes(key), media_type="application/octet-stream", headers=headers)


@router.get("/{file_id}", response_model=FileOut, summary="Get a file's metadata")
async def get_file(file_id: uuid.UUID, ctx: ReadCtx, db: DbSession) -> FileOut:
    file, meta = await service.get_file_detail(db, ctx, file_id)
    return FileOut.from_model(file, meta)


@router.get("/{file_id}/download-url", response_model=DownloadUrlOut,
            summary="Get a short-lived download URL")
async def get_download_url(file_id: uuid.UUID, ctx: ReadCtx, db: DbSession) -> DownloadUrlOut:
    return await service.get_download_url(db, ctx, file_id)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response,
               summary="Delete a file and everything derived from it")
async def delete_file(file_id: uuid.UUID, ctx: WriteCtx, db: DbSession) -> Response:
    await service.delete_file(db, ctx, file_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

