"""files ORM models."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, SoftDeleteMixin, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class FileStatus:
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    QUARANTINED = "quarantined"
    FAILED = "failed"
    DELETED = "deleted"

    READABLE = (UPLOADED, PROCESSING, READY, FAILED)


class FilePurpose:
    USER_UPLOAD = "user_upload"
    TASK_ARTIFACT = "task_artifact"
    BROWSER_ARTIFACT = "browser_artifact"
    TEMP = "temp"

    ALL = (USER_UPLOAD, TASK_ARTIFACT, BROWSER_ARTIFACT, TEMP)


class ExtractionStatus:
    PENDING = "pending"
    COMPLETED = "completed"
    TRUNCATED = "truncated"
    SKIPPED = "skipped"
    FAILED = "failed"


class File(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, SoftDeleteMixin, Base):
    """An uploaded or generated file. Bytes live in object storage under ``object_key``
    (server generated); ``filename`` is a sanitized display name only."""

    __tablename__ = "files"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    task_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    object_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    # Sniffed from the bytes; the client-declared type is never trusted.
    content_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=FileStatus.UPLOADED)
    scan_status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    scan_signature: Mapped[str | None] = mapped_column(String(200), nullable=True)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False, default=FilePurpose.USER_UPLOAD)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_files_tenant_user_created", "tenant_id", "user_id", "created_at"),
        Index("ix_files_tenant_sha256", "tenant_id", "sha256"),
        Index("ix_files_status_updated", "status", "updated_at"),
        Index("ix_files_expires_at", "expires_at",
              postgresql_where=text("expires_at IS NOT NULL AND deleted_at IS NULL")),
    )


class FileMetadata(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    """Derived facts about a file produced by the processing pipeline."""

    __tablename__ = "file_metadata"

    file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=False,
                                               unique=True)
    extraction_status: Mapped[str] = mapped_column(String(20), nullable=False,
                                                   default=ExtractionStatus.PENDING)
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    char_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    chunk_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    extracted_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    extra: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
