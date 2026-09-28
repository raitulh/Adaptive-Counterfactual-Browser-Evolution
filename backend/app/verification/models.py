from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, UUIDPrimaryKeyMixin


class VerificationResult(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    __tablename__ = "verification_results"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    step_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=True)
    attempt_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default="step")  # step | task
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False)
    expected: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    observed: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    differences: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    evidence: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    verified_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))

    __table_args__ = (Index("ix_verification_results_task", "task_id", "verified_at"),)
