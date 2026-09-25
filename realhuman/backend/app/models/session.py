from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, JsonType, new_id, utcnow


class VerificationSession(Base):
    """
    One verification attempt from a browser, from creation to decision.

    Network identifiers are stored only as keyed hashes (HMAC with the server
    secret): enough to compare "same client?" and count requests, never the raw
    IP address or user agent.
    """

    __tablename__ = "verification_sessions"
    __table_args__ = (
        Index("ix_verification_sessions_project_created", "project_id", "created_at"),
        Index("ix_verification_sessions_ip_created", "ip_hash", "created_at"),
        Index("ix_verification_sessions_status_expires", "status", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("sess"))
    project_id: Mapped[str] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    status: Mapped[str] = mapped_column(String(16), default="challenged")
    challenge_type: Mapped[str] = mapped_column(String(16), default="press_hold")
    action: Mapped[str | None] = mapped_column(String(64), default=None)
    origin: Mapped[str] = mapped_column(String(255), default="unknown")

    ip_hash: Mapped[str] = mapped_column(String(64))
    ua_hash: Mapped[str] = mapped_column(String(64))
    lang_hash: Mapped[str | None] = mapped_column(String(64), default=None)

    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    expires_at: Mapped[datetime]
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    last_challenge: Mapped[str | None] = mapped_column(String(16), default=None)

    # Latest decision.
    outcome: Mapped[str | None] = mapped_column(String(16), default=None, index=True)
    decision: Mapped[str | None] = mapped_column(String(16), default=None)
    risk: Mapped[str | None] = mapped_column(String(8), default=None)
    score: Mapped[float | None] = mapped_column(Float, default=None)
    decided_at: Mapped[datetime | None] = mapped_column(default=None)

    # Single-use verification token, issued on "allow". Only its hash is stored.
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True, default=None)
    token_expires_at: Mapped[datetime | None] = mapped_column(default=None)
    token_redeemed_at: Mapped[datetime | None] = mapped_column(default=None)

    signals: Mapped[list[SignalRecord]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="SignalRecord.id",
    )


class SignalRecord(Base):
    """A resolved signal for one challenge attempt, with its factor breakdown."""

    __tablename__ = "signals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("verification_sessions.id", ondelete="CASCADE"), index=True
    )
    attempt: Mapped[int] = mapped_column(Integer)
    signal_id: Mapped[str] = mapped_column(String(32))
    label: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(8))
    score: Mapped[float] = mapped_column(Float)
    weight: Mapped[float] = mapped_column(Float)
    detail: Mapped[str | None] = mapped_column(String(255), default=None)
    factors: Mapped[list[dict]] = mapped_column(JsonType, default=list)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    session: Mapped[VerificationSession] = relationship(back_populates="signals")
