from __future__ import annotations

from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, JsonType, new_id, utcnow


class WebhookEndpoint(Base):
    __tablename__ = "webhook_endpoints"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("wh"))
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    url: Mapped[str] = mapped_column(String(2048))
    events: Mapped[list[str]] = mapped_column(JsonType)
    status: Mapped[str] = mapped_column(String(16), default="active")
    # Signing secret, encrypted at rest with a key derived from SECRET_KEY.
    secret_encrypted: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    deliveries: Mapped[list[WebhookDelivery]] = relationship(
        back_populates="endpoint", cascade="all, delete-orphan", passive_deletes=True
    )


class WebhookDelivery(Base):
    """Outbox row: one event for one endpoint, retried with backoff until delivered."""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (Index("ix_webhook_deliveries_status_next", "status", "next_attempt_at"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("whd"))
    endpoint_id: Mapped[str] = mapped_column(
        ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), index=True
    )
    event_id: Mapped[str] = mapped_column(String(32))
    event_type: Mapped[str] = mapped_column(String(48))
    payload: Mapped[dict] = mapped_column(JsonType)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime | None] = mapped_column(default=utcnow)
    last_status_code: Mapped[int | None] = mapped_column(Integer, default=None)
    last_error: Mapped[str | None] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(default=None)

    endpoint: Mapped[WebhookEndpoint] = relationship(back_populates="deliveries")
