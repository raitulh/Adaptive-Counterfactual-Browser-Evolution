from __future__ import annotations

from datetime import datetime

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, new_id, utcnow


class ContactRequest(Base):
    __tablename__ = "contact_requests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("ctc"))
    name: Mapped[str] = mapped_column(String(80))
    email: Mapped[str] = mapped_column(String(320))
    company: Mapped[str | None] = mapped_column(String(120), default=None)
    message: Mapped[str | None] = mapped_column(Text, default=None)
    ip_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
