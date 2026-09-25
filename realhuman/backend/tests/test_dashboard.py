from __future__ import annotations

from tests.conftest import DASHBOARD_ORIGIN, create_session, human_telemetry, signup, submit


def _site_key(client) -> str:
    return client.get("/v1/project/settings").json()["siteKey"]


def _traffic(client, clock, site_key: str) -> None:
    for _ in range(2):  # verified
        session = create_session(client, site_key=site_key)
        clock.advance(seconds=2)
        submit(client, session["id"])
    session = create_session(client, site_key=site_key)  # step_up
    clock.advance(seconds=2)
    submit(
        client,
        session["id"],
        telemetry=human_telemetry(approachStraightness=0.999, approachSpeedCv=0.01),
    )
    create_session(client, site_key=site_key)  # expires
    clock.advance(seconds=200)
    from app.services.session_service import expire_stale_sessions

    with client.app.state.session_factory() as db:
        expire_stale_sessions(db, clock.now())


def test_overview_counts_outcomes(client, clock):
    signup(client)
    _traffic(client, clock, _site_key(client))
    overview = client.get("/v1/dashboard/overview").json()
    assert overview["rangeDays"] == 7 and overview["sample"] is False
    assert len(overview["activity"]) == 14
    today = overview["activity"][-1]
    assert today["date"].endswith("T00:00:00.000Z")
    assert (today["verified"], today["suspicious"], today["blocked"]) == (2, 1, 0)
    metrics = overview["metrics"]
    assert metrics["volume"] == {"value": 3, "delta": 0.0}
    assert metrics["verified"]["value"] == 2


def test_events_sessions_and_logs(client, clock):
    signup(client)
    _traffic(client, clock, _site_key(client))

    events = client.get("/v1/events", params={"limit": 10}).json()
    # Newest first: the step-up session also expired after its step-up.
    assert [event["outcome"] for event in events] == [
        "expired",
        "expired",
        "step_up",
        "verified",
        "verified",
    ]
    assert all(event["origin"] == "localhost:3000" for event in events)
    assert events[-1]["action"] == "signup"

    sessions = client.get("/v1/sessions").json()
    assert sorted(s["outcome"] for s in sessions) == ["expired", "expired", "verified", "verified"]
    expired = [s for s in sessions if s["outcome"] == "expired"]
    assert {s["challenge"] for s in expired} == {"none", "press_hold"}
    assert all(s["durationMs"] == 120_000 for s in expired)
    verified = client.get("/v1/sessions", params={"outcome": "verified"}).json()
    assert len(verified) == 2 and all(s["durationMs"] == 2000 for s in verified)
    assert client.get("/v1/sessions", params={"outcome": "nope"}).status_code == 422

    logs = client.get("/v1/logs", params={"limit": 50}).json()
    assert len(logs) == 7  # 4 session creations + 3 challenges
    assert {log["method"] for log in logs} == {"POST"}
    assert {log["status"] for log in logs} == {200, 201}


def test_dashboard_is_scoped_to_the_project(client, clock):
    signup(client, "one@example.com")
    _traffic(client, clock, _site_key(client))
    client.post("/v1/auth/logout", headers={"Origin": DASHBOARD_ORIGIN})
    signup(client, "two@example.com")
    assert client.get("/v1/events").json() == []
    assert client.get("/v1/sessions").json() == []
    assert client.get("/v1/logs").json() == []
    assert client.get("/v1/dashboard/overview").json()["metrics"]["volume"]["value"] == 0


def test_limits_are_validated(client):
    signup(client)
    assert client.get("/v1/events", params={"limit": 0}).status_code == 422
    assert client.get("/v1/logs", params={"limit": 1000}).status_code == 422
