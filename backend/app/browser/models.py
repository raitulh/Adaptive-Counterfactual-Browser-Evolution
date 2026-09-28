"""browser ORM models.

``BrowserTask`` is the durable unit of browser work dispatched by a browser tool and
executed out-of-band by the isolated browser worker. It is idempotent on the engine's
step idempotency key. ``BrowserSession`` records one isolated browser-context run of a
task by a specific worker (a task that is retried after a worker crash has several).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class BrowserTaskStatus:
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"

    TERMINAL = (SUCCEEDED, FAILED, CANCELLED)
    ALL = (QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED)


class BrowserSessionStatus:
    STARTING = "starting"
    ACTIVE = "active"
    CLOSED = "closed"
    CRASHED = "crashed"

    OPEN = (STARTING, ACTIVE)


class BrowserTask(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, Base):
    __tablename__ = "browser_tasks"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # The engine's step idempotency key: the worker reports the outcome against it.
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    # Validated action list (``app.browser.actions``). Fill values are redacted once terminal.
    actions: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    # Execution options: locator order, expectations, step attempt bookkeeping.
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=BrowserTaskStatus.QUEUED)
    # Bounded, sanitized observations (untrusted page content).
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    error_class: Mapped[str | None] = mapped_column(String(40), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=120)
    # Object-storage keys written for this task (screenshots); purged with the row.
    artifact_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    started_at: Mapped[datetime | None] = mapped_column(nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (Index("ix_browser_tasks_status_created", "status", "created_at"),)


class BrowserSession(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    __tablename__ = "browser_sessions"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False,
                                               index=True)
    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=False)
    browser_task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("browser_tasks.id", ondelete="CASCADE"),
                                                       nullable=False, index=True)
    worker_id: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=BrowserSessionStatus.STARTING)
    started_at: Mapped[datetime] = mapped_column(nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(nullable=True)
    pages_visited: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    actions_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
