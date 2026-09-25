from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id, utcnow


class VerificationEvent(Base):
    """An outcome: every decision (verified / step_up / blocked) and every expiry."""

    __tablename__ = "verification_events"
    __table_args__ = (Index("ix_verification_events_project_created", "project_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("evt"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    session_id: Mapped[str] = mapped_column(
        ForeignKey("verification_sessions.id", ondelete="CASCADE"), index=True
    )
    outcome: Mapped[str] = mapped_column(String(16))
    risk: Mapped[str] = mapped_column(String(8))
    score: Mapped[float] = mapped_column(Float)
    origin: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class RequestLog(Base):
    """Verification API requests attributed to a project (never payloads)."""

    __tablename__ = "request_logs"
    __table_args__ = (Index("ix_request_logs_project_created", "project_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("req"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    method: Mapped[str] = mapped_column(String(8))
    path: Mapped[str] = mapped_column(String(255))
    status: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[int] = mapped_column(Integer)
    request_id: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
