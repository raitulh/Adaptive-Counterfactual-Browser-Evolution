"""Engine and session factory. One engine per application instance."""

from __future__ import annotations

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import Settings


def create_db_engine(settings: Settings) -> Engine:
    if settings.is_sqlite:
        # SQLite is supported for tests and quick experiments only.
        in_memory = ":memory:" in settings.database_url or settings.database_url.endswith("://")
        engine = create_engine(
            settings.database_url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool if in_memory else None,
        )

        @event.listens_for(engine, "connect")
        def _enable_foreign_keys(dbapi_connection, _record):  # pragma: no cover - driver hook
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        return engine

    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=10,
        # Day buckets and timestamps are always computed in UTC.
        connect_args={"options": "-c timezone=utc"},
    )


def create_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
