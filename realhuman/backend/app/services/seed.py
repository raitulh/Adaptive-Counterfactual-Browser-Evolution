"""Idempotent demo data for local development (SEED_DEMO=true)."""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.config import Settings
from app.models import Project, ProjectSettings, User
from app.security.auth import hash_password

logger = logging.getLogger("realhuman.seed")


def seed_demo(session_factory: sessionmaker[Session], settings: Settings, clock: Clock) -> None:
    now = clock.now()
    with session_factory() as db:
        if db.scalar(select(Project.id).where(Project.site_key == settings.demo_site_key)):
            return
        user = db.scalar(select(User).where(User.email == settings.demo_email))
        if user is None:
            password = settings.demo_password or secrets.token_urlsafe(12)
            user = User(
                email=settings.demo_email,
                password_hash=hash_password(password),
                workspace_name="Demo workspace",
                created_at=now,
            )
            db.add(user)
            if not settings.demo_password:
                logger.warning(
                    "Created demo account %s with generated password %s",
                    settings.demo_email,
                    password,
                )
        project = Project(name="Demo project", site_key=settings.demo_site_key, created_at=now)
        project.settings = ProjectSettings(updated_at=now)
        user.projects.append(project)
        db.commit()
        logger.info("Seeded demo project with site key %s", settings.demo_site_key)
