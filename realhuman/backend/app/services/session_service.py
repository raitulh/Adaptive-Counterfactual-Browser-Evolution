"""Verification session lifecycle: creation, outcome events, expiry."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ApiError
from app.models import Project, VerificationEvent, VerificationSession
from app.security.crypto import Pseudonymizer
from app.services.network import RequestMeta
from app.services.webhook_service import enqueue_event

ACTIVE_STATUSES = ("created", "challenged")


def resolve_project(db: Session, site_key: str | None, settings: Settings) -> Project:
    key = site_key or settings.default_site_key
    if not key:
        raise ApiError(422, "VALIDATION_ERROR", "A site key is required.")
    project = db.scalar(select(Project).where(Project.site_key == key))
    if project is None:
        raise ApiError(401, "UNAUTHORIZED", "Unknown site key.")
    return project


def create_session(
    db: Session,
    project: Project,
    *,
    action: str | None,
    meta: RequestMeta,
    pseudonymize: Pseudonymizer,
    settings: Settings,
    now: datetime,
) -> VerificationSession:
    session = VerificationSession(
        project_id=project.id,
        status="challenged",
        challenge_type="press_hold",
        action=action,
        origin=meta.origin,
        ip_hash=pseudonymize(meta.ip or "unknown"),
        ua_hash=pseudonymize(meta.user_agent),
        lang_hash=pseudonymize(meta.accept_language),
        created_at=now,
        expires_at=now + timedelta(seconds=settings.verification_session_ttl_seconds),
    )
    db.add(session)
    return session


def record_event(
    db: Session, session: VerificationSession, outcome: str, now: datetime
) -> VerificationEvent:
    """Stores an outcome event and queues matching webhook deliveries."""
    event = VerificationEvent(
        project_id=session.project_id,
        session_id=session.id,
        outcome=outcome,
        risk=session.risk or "medium",
        score=session.score if session.score is not None else 0.0,
        origin=session.origin,
        action=session.action or "unknown",
        created_at=now,
    )
    db.add(event)
    db.flush()
    enqueue_event(db, event, now)
    return event


def expire_session(db: Session, session: VerificationSession, now: datetime) -> None:
    session.status = "expired"
    session.outcome = "expired"
    record_event(db, session, "expired", now)


def expire_stale_sessions(db: Session, now: datetime, limit: int = 500) -> int:
    """Marks sessions whose challenge window passed without a final decision."""
    stale = db.scalars(
        select(VerificationSession)
        .where(
            VerificationSession.status.in_(ACTIVE_STATUSES),
            VerificationSession.expires_at <= now,
        )
        .limit(limit)
        .with_for_update(skip_locked=True)
    ).all()
    for session in stale:
        expire_session(db, session, now)
    db.commit()
    return len(stale)
