"""Read models for the developer dashboard."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import RequestLog, VerificationEvent, VerificationSession
from app.schemas.dashboard import (
    ActivityPoint,
    Metric,
    OverviewMetrics,
    OverviewOut,
    RequestLogOut,
    SessionRecordOut,
    VerificationEventOut,
)

ACTIVITY_DAYS = 14
RANGE_DAYS = 7
# Chart series ← event outcomes. Expired sessions are not part of the volume.
SERIES = {"verified": "verified", "step_up": "suspicious", "blocked": "blocked"}


def _percent_change(current: int, previous: int) -> float:
    if previous == 0:
        return 0.0
    return round((current - previous) / previous * 100, 1)


def _day_bucket(db: Session):
    column = VerificationEvent.created_at
    if db.get_bind().dialect.name == "postgresql":
        return func.date(func.timezone("UTC", column))
    return func.date(column)


def _as_date(value: date | datetime | str) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def overview(db: Session, project_id: str, now: datetime) -> OverviewOut:
    today = now.astimezone(UTC).date()
    first_day = today - timedelta(days=ACTIVITY_DAYS - 1)
    window_start = datetime.combine(first_day, time.min, tzinfo=UTC)

    bucket = _day_bucket(db).label("day")
    rows = db.execute(
        select(bucket, VerificationEvent.outcome, func.count())
        .where(
            VerificationEvent.project_id == project_id,
            VerificationEvent.created_at >= window_start,
            VerificationEvent.outcome.in_(tuple(SERIES)),
        )
        .group_by(bucket, VerificationEvent.outcome)
    ).all()

    counts: dict[date, dict[str, int]] = {
        first_day + timedelta(days=i): {"verified": 0, "suspicious": 0, "blocked": 0}
        for i in range(ACTIVITY_DAYS)
    }
    for day, outcome, count in rows:
        bucket_counts = counts.get(_as_date(day))
        if bucket_counts is not None:
            bucket_counts[SERIES[outcome]] += int(count)

    activity = [
        ActivityPoint(date=datetime.combine(day, time.min, tzinfo=UTC), **values)
        for day, values in sorted(counts.items())
    ]
    previous, current = activity[:RANGE_DAYS], activity[RANGE_DAYS:]

    def total(points: list[ActivityPoint], key: str) -> int:
        return sum(getattr(point, key) for point in points)

    def metric(key: str) -> Metric:
        now_value, before = total(current, key), total(previous, key)
        return Metric(value=now_value, delta=_percent_change(now_value, before))

    def volume(points: list[ActivityPoint]) -> int:
        return sum(total(points, key) for key in ("verified", "suspicious", "blocked"))

    return OverviewOut(
        range_days=RANGE_DAYS,
        sample=False,
        metrics=OverviewMetrics(
            volume=Metric(
                value=volume(current),
                delta=_percent_change(volume(current), volume(previous)),
            ),
            verified=metric("verified"),
            suspicious=metric("suspicious"),
            blocked=metric("blocked"),
        ),
        activity=activity,
    )


def recent_events(db: Session, project_id: str, limit: int) -> list[VerificationEventOut]:
    events = db.scalars(
        select(VerificationEvent)
        .where(VerificationEvent.project_id == project_id)
        .order_by(VerificationEvent.created_at.desc(), VerificationEvent.id)
        .limit(limit)
    ).all()
    return [
        VerificationEventOut(
            id=event.id,
            session_id=event.session_id,
            outcome=event.outcome,
            risk=event.risk,
            score=event.score,
            origin=event.origin,
            action=event.action,
            at=event.created_at,
        )
        for event in events
    ]


def list_sessions(
    db: Session, project_id: str, outcome: str | None, limit: int = 100
) -> list[SessionRecordOut]:
    query = select(VerificationSession).where(
        VerificationSession.project_id == project_id, VerificationSession.outcome.is_not(None)
    )
    if outcome:
        query = query.where(VerificationSession.outcome == outcome)
    sessions = db.scalars(
        query.order_by(VerificationSession.created_at.desc(), VerificationSession.id).limit(limit)
    ).all()
    records = []
    for session in sessions:
        ended = session.expires_at if session.outcome == "expired" else session.decided_at
        duration = max(
            0, int(((ended or session.created_at) - session.created_at).total_seconds() * 1000)
        )
        records.append(
            SessionRecordOut(
                id=session.id,
                outcome=session.outcome,
                risk=session.risk or "medium",
                score=session.score if session.score is not None else 0.0,
                challenge=session.last_challenge or "none",
                origin=session.origin,
                started_at=session.created_at,
                duration_ms=duration,
            )
        )
    return records


def request_logs(db: Session, project_id: str, limit: int) -> list[RequestLogOut]:
    logs = db.scalars(
        select(RequestLog)
        .where(RequestLog.project_id == project_id)
        .order_by(RequestLog.created_at.desc(), RequestLog.id)
        .limit(limit)
    ).all()
    return [
        RequestLogOut(
            id=log.id,
            method=log.method,
            path=log.path,
            status=log.status,
            latency_ms=log.latency_ms,
            at=log.created_at,
        )
        for log in logs
    ]
