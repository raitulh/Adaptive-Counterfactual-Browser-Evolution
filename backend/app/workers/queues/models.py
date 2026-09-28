"""Durable job table backing the PostgreSQL queue implementation."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TimestampMixin, UUIDPrimaryKeyMixin


class JobStatus:
    PENDING = "pending"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    DEAD = "dead"
    CANCELLED = "cancelled"


class Job(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jobs"

    queue: Mapped[str] = mapped_column(String(50), nullable=False)
    job_type: Mapped[str] = mapped_column(String(100), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=JobStatus.PENDING)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    run_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=5)
    locked_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    locked_until: Mapped[datetime | None] = mapped_column(nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    dedupe_key: Mapped[str | None] = mapped_column(String(200), nullable=True)
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index(
            "ix_jobs_claimable",
            "queue",
            "priority",
            "run_at",
            postgresql_where=text("status = 'pending'"),
        ),
        Index("ix_jobs_running_lease", "locked_until", postgresql_where=text("status = 'running'")),
        # At most one *pending* job per (queue, dedupe_key): repeated enqueues coalesce.
        Index(
            "uq_jobs_pending_dedupe",
            "queue",
            "dedupe_key",
            unique=True,
            postgresql_where=text("status = 'pending' AND dedupe_key IS NOT NULL"),
        ),
        Index("ix_jobs_status_finished", "status", "finished_at"),
    )
