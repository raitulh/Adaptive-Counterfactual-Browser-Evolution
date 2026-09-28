"""files API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.files.models import File, FileMetadata


class FileMetadataOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    extraction_status: str
    page_count: int | None = None
    char_count: int | None = None
    chunk_count: int | None = None
    language: str | None = None
    extracted_summary: str | None = None


class FileOut(BaseModel):
    id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    sha256: str
    status: str
    scan_status: str
    purpose: str
    user_id: uuid.UUID
    task_id: uuid.UUID | None = None
    created_at: datetime
    updated_at: datetime
    expires_at: datetime | None = None
    metadata: FileMetadataOut | None = None

    @classmethod
    def from_model(cls, file: File, metadata: FileMetadata | None = None) -> FileOut:
        return cls(
            id=file.id, filename=file.filename, content_type=file.content_type, size_bytes=file.size_bytes,
            sha256=file.sha256, status=file.status, scan_status=file.scan_status, purpose=file.purpose,
            user_id=file.user_id, task_id=file.task_id, created_at=file.created_at,
            updated_at=file.updated_at, expires_at=file.expires_at,
            metadata=FileMetadataOut.model_validate(metadata) if metadata is not None else None,
        )


class DownloadUrlOut(BaseModel):
    url: str
    method: str = "GET"
    expires_at: datetime
    filename: str
