from __future__ import annotations

from sqlalchemy import func, select

from app.models import RequestLog, VerificationEvent, VerificationSession
from app.services.retention import purge_expired_data
from app.services.session_service import expire_stale_sessions
from tests.conftest import create_session, verify_human


def test_expiry_sweep_marks_abandoned_sessions(client, app, clock):
    session = create_session(client)
    with app.state.session_factory() as db:
        assert expire_stale_sessions(db, clock.now()) == 0
    clock.advance(seconds=121)
    with app.state.session_factory() as db:
        assert expire_stale_sessions(db, clock.now()) == 1
        stored = db.get(VerificationSession, session["id"])
        assert (stored.status, stored.outcome) == ("expired", "expired")
        assert db.scalar(select(func.count()).select_from(VerificationEvent)) == 1
        assert expire_stale_sessions(db, clock.now()) == 0


def test_retention_purges_old_data(client, app, clock):
    verify_human(client, clock)
    with app.state.session_factory() as db:
        assert purge_expired_data(db, clock.now())["sessions"] == 0
    clock.advance(days=8)  # default retention is 7 days
    with app.state.session_factory() as db:
        removed = purge_expired_data(db, clock.now())
        assert removed["sessions"] == 1 and removed["events"] == 1 and removed["logs"] == 2
        assert db.scalar(select(func.count()).select_from(RequestLog)) == 0


def test_worker_tick_runs_due_jobs(client, app, clock):
    from app.services.worker import BackgroundWorker

    session = create_session(client)
    clock.advance(seconds=121)
    worker = BackgroundWorker(
        app.state.session_factory, app.state.dispatcher, clock, interval_seconds=60
    )
    worker.tick()
    with app.state.session_factory() as db:
        assert db.get(VerificationSession, session["id"]).status == "expired"
