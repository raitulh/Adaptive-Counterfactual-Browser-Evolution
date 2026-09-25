"""
Test fixtures. Runs against in-memory SQLite by default; set TEST_DATABASE_URL
to run the same suite against PostgreSQL, e.g.

    TEST_DATABASE_URL=postgresql+psycopg://realhuman:realhuman@localhost:5432/realhuman_test pytest
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.clock import Clock
from app.config import Settings
from app.main import create_app
from app.models import Base

DASHBOARD_ORIGIN = "http://localhost:3000"
BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Origin": DASHBOARD_ORIGIN,
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
}
DEMO_SITE_KEY = "pk_test_demo_5f2c81a9e04b"
PASSWORD = "correct horse battery staple"


class FakeClock(Clock):
    def __init__(self, start: datetime | None = None) -> None:
        self.current = start or datetime(2026, 9, 24, 12, 0, 0, tzinfo=UTC)

    def now(self) -> datetime:
        return self.current

    def advance(self, **delta: float) -> None:
        self.current += timedelta(**delta)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": os.environ.get("TEST_DATABASE_URL", "sqlite+pysqlite:///:memory:"),
        "secret_key": "test-secret-key-0123456789abcdef-0123456789",
        "cors_origins": [DASHBOARD_ORIGIN],
        "worker_enabled": False,
        "seed_demo": True,
        "demo_password": "demo-password-123",
        "demo_site_key": DEMO_SITE_KEY,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
def app(settings: Settings, clock: FakeClock):
    application = create_app(settings, clock=clock)
    engine = application.state.engine
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield application
    Base.metadata.drop_all(engine)


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app, base_url="http://testserver") as test_client:
        yield test_client


def signup(client: TestClient, email: str = "dev@example.com") -> dict:
    response = client.post(
        "/v1/auth/signup",
        json={"email": email, "password": PASSWORD},
        headers={"Origin": DASHBOARD_ORIGIN},
    )
    assert response.status_code == 201, response.text
    return response.json()


def human_telemetry(**overrides: Any) -> dict:
    telemetry = {
        "version": 1,
        "pointerType": "mouse",
        "approachMoves": 23,
        "approachPathPx": 311.5,
        "approachStraightness": 0.87,
        "approachSpeedCv": 0.64,
        "holdMoves": 2,
        "holdJitterPx": 1.4,
        "timeToFirstInputMs": 820,
        "keyRepeats": 0,
        "untrustedEvents": 0,
        "visibilityChanges": 0,
        "earlyReleases": 0,
        "webdriver": False,
        "maxTouchPoints": 0,
        "pageDwellMs": 14_250,
    }
    telemetry.update(overrides)
    return telemetry


def create_session(
    client: TestClient,
    site_key: str | None = DEMO_SITE_KEY,
    headers: dict | None = None,
    action: str = "signup",
) -> dict:
    body: dict[str, Any] = {"action": action}
    if site_key:
        body["siteKey"] = site_key
    response = client.post("/v1/sessions", json=body, headers=headers or BROWSER_HEADERS)
    assert response.status_code == 201, response.text
    return response.json()


def submit(
    client: TestClient,
    session_id: str,
    *,
    telemetry: dict | None = None,
    headers: dict | None = None,
    **fields: Any,
):
    body = {
        "type": "press_hold",
        "inputMethod": "pointer",
        "holdDurationMs": 1112,
        "telemetry": telemetry if telemetry is not None else human_telemetry(),
        **fields,
    }
    if telemetry is False:  # explicitly omit telemetry
        body.pop("telemetry")
    return client.post(
        f"/v1/sessions/{session_id}/challenge", json=body, headers=headers or BROWSER_HEADERS
    )


def verify_human(client: TestClient, clock: FakeClock, **kwargs: Any) -> dict:
    session = create_session(client, **kwargs)
    clock.advance(seconds=2)
    response = submit(client, session["id"])
    assert response.status_code == 200, response.text
    return response.json()
