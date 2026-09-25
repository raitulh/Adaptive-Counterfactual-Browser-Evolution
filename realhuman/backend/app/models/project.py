from __future__ import annotations

from datetime import datetime

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, new_id, utcnow


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=lambda: new_id("prj"))
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))
    # Public key identifying the widget integration. Safe to expose.
    site_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)

    owner: Mapped[User] = relationship(back_populates="projects")  # noqa: F821
    settings: Mapped[ProjectSettings] = relationship(
        back_populates="project", cascade="all, delete-orphan", uselist=False, lazy="joined"
    )


class ProjectSettings(Base):
    """Verification policy and data retention for a project."""

    __tablename__ = "project_settings"

    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True
    )
    allow_threshold: Mapped[float] = mapped_column(Float, default=0.8)
    step_up_threshold: Mapped[float] = mapped_column(Float, default=0.5)
    retention_days: Mapped[int] = mapped_column(Integer, default=7)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)

    project: Mapped[Project] = relationship(back_populates="settings")
