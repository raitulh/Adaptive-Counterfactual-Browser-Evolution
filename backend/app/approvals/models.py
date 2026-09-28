from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, TenantScopedMixin, TimestampMixin, UUIDPrimaryKeyMixin, VersionedMixin


class ApprovalRequest(UUIDPrimaryKeyMixin, TenantScopedMixin, TimestampMixin, VersionedMixin, Base):
    """A durable request for a human decision on one *concrete* action.

    ``action_hash`` binds the approval to the exact tool + resolved arguments: if
    anything changes, the approval no longer applies. Approvals expire, are
    re-checked at execution time, and are single-use (``consumed_at``).
    """

    __tablename__ = "approval_requests"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    step_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("task_steps.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    tool_version: Mapped[str] = mapped_column(String(20), nullable=False, default="v1")
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    target: Mapped[str | None] = mapped_column(String(500), nullable=True)
    arguments_preview: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    action_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False)
    permission_level: Mapped[str] = mapped_column(String(24), nullable=False)
    reasons: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rejected_by: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    consumed_at: Mapped[datetime | None] = mapped_column(nullable=True)

    __table_args__ = (
        Index("ix_approval_requests_tenant_user_status", "tenant_id", "user_id", "status"),
        Index("ix_approval_requests_pending_expiry", "expires_at", postgresql_where=text("status = 'pending'")),
        Index("uq_approval_requests_pending_step", "step_id", "action_hash", unique=True,
              postgresql_where=text("status = 'pending'")),
    )


class ApprovalAction(UUIDPrimaryKeyMixin, TenantScopedMixin, Base):
    """Append-only history of approval decisions."""

    __tablename__ = "approval_actions"

    approval_request_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("approval_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    actor_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(nullable=False, server_default=text("now()"))
