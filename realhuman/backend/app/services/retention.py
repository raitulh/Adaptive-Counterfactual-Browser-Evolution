"""Deletes data past each project's retention window."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    AuthSession,
    ProjectSettings,
    RequestLog,
    VerificationEvent,
    VerificationSession,
    WebhookDelivery,
)

DELIVERY_RETENTION = timedelta(days=30)


def purge_expired_data(db: Session, now: datetime) -> dict[str, int]:
    removed = {"events": 0, "sessions": 0, "logs": 0, "auth_sessions": 0, "deliveries": 0}
    for settings in db.scalars(select(ProjectSettings)).all():
        cutoff = now - timedelta(days=settings.retention_days)
        project = settings.project_id
        removed["events"] += db.execute(
            delete(VerificationEvent).where(
                VerificationEvent.project_id == project, VerificationEvent.created_at < cutoff
            )
        ).rowcount
        removed["logs"] += db.execute(
            delete(RequestLog).where(
                RequestLog.project_id == project, RequestLog.created_at < cutoff
            )
        ).rowcount
        removed["sessions"] += db.execute(
            delete(VerificationSession).where(
                VerificationSession.project_id == project,
                VerificationSession.created_at < cutoff,
            )
        ).rowcount
    removed["auth_sessions"] = db.execute(
        delete(AuthSession).where(AuthSession.expires_at < now)
    ).rowcount
    removed["deliveries"] = db.execute(
        delete(WebhookDelivery).where(
            WebhookDelivery.status != "pending",
            WebhookDelivery.created_at < now - DELIVERY_RETENTION,
        )
    ).rowcount
    db.commit()
    return removed
