from __future__ import annotations

import re

from tests.conftest import (
    BROWSER_HEADERS,
    DEMO_SITE_KEY,
    create_session,
    human_telemetry,
    signup,
    submit,
    verify_human,
)

ISO_Z = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
SIGNAL_IDS = [
    "interaction_pattern",
    "challenge_response",
    "session_consistency",
    "request_behavior",
]


def test_create_session_matches_contract(client):
    session = create_session(client)
    assert session["id"].startswith("sess_")
    assert session["status"] == "challenged"
    assert session["challenge"] == {"type": "press_hold", "ttlSeconds": 120}
    assert ISO_Z.match(session["createdAt"]) and ISO_Z.match(session["expiresAt"])


def test_unknown_site_key_is_rejected(client):
    response = client.post("/v1/sessions", json={"siteKey": "pk_nope"}, headers=BROWSER_HEADERS)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_missing_site_key_uses_default_or_fails(client, app):
    response = client.post("/v1/sessions", json={}, headers=BROWSER_HEADERS)
    assert response.status_code == 422
    app.state.settings.default_site_key = DEMO_SITE_KEY
    assert client.post("/v1/sessions", json={}, headers=BROWSER_HEADERS).status_code == 201


def test_human_session_is_allowed_with_token(client, clock):
    result = verify_human(client, clock)
    assert result["decision"] == "allow"
    assert result["verified"] is True
    assert result["risk"] == "low"
    assert result["score"] >= 0.8
    assert result["token"].startswith("rh_vt_")
    assert [signal["id"] for signal in result["signals"]] == SIGNAL_IDS
    for signal in result["signals"]:
        assert signal["status"] == "pass"
        assert set(signal) <= {"id", "label", "status", "score", "weight", "detail"}
    assert ISO_Z.match(result["decidedAt"])


def test_scripted_browser_never_gets_a_token(client, clock):
    headers = {**BROWSER_HEADERS, "User-Agent": "Mozilla/5.0 HeadlessChrome/130.0.0.0"}
    session = create_session(client, headers=headers)
    clock.advance(seconds=1.2)
    telemetry = human_telemetry(
        webdriver=True, untrustedEvents=4, timeToFirstInputMs=40, approachMoves=0
    )
    response = submit(client, session["id"], telemetry=telemetry, headers=headers)
    body = response.json()
    assert response.status_code == 200
    assert body["decision"] == "deny"
    assert body["token"] is None
    assert body["risk"] == "high"
    failing = {s["id"] for s in body["signals"] if s["status"] == "fail"}
    assert {"interaction_pattern", "session_consistency"} <= failing


def test_fabricated_hold_is_rejected(client, clock):
    session = create_session(client)
    clock.advance(seconds=0.3)  # the session is younger than the claimed hold
    body = submit(client, session["id"]).json()
    challenge = next(s for s in body["signals"] if s["id"] == "challenge_response")
    assert challenge["status"] == "fail"
    assert "longer than the session" in challenge["detail"]
    assert body["decision"] != "allow"


def test_short_hold_fails_challenge_signal(client, clock):
    session = create_session(client)
    clock.advance(seconds=2)
    body = submit(client, session["id"], holdDurationMs=300).json()
    challenge = next(s for s in body["signals"] if s["id"] == "challenge_response")
    assert challenge["status"] == "fail"


def test_step_up_then_retry_on_same_session(client, clock):
    session = create_session(client)
    clock.advance(seconds=2)
    uniform = human_telemetry(approachStraightness=0.999, approachSpeedCv=0.01)
    first = submit(client, session["id"], telemetry=uniform).json()
    assert first["decision"] == "step_up"
    assert first["token"] is None
    clock.advance(seconds=3)
    second = submit(client, session["id"]).json()
    assert second["decision"] == "allow"
    assert second["token"]


def test_session_blocked_after_exhausting_step_ups(client, clock):
    session = create_session(client)
    uniform = human_telemetry(approachStraightness=0.999, approachSpeedCv=0.01)
    decisions = []
    for _ in range(3):
        clock.advance(seconds=2)
        decisions.append(submit(client, session["id"], telemetry=uniform).json()["decision"])
    assert decisions == ["step_up", "step_up", "deny"]
    again = submit(client, session["id"])
    assert again.status_code == 410
    assert again.json()["error"]["code"] == "SESSION_EXPIRED"


def test_completed_session_cannot_be_reused(client, clock):
    result = verify_human(client, clock)
    response = submit(client, result["sessionId"])
    assert response.status_code == 410


def test_expired_session(client, clock):
    session = create_session(client)
    clock.advance(seconds=121)
    response = submit(client, session["id"])
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "SESSION_EXPIRED"
    assert response.headers["x-request-id"] == response.json()["error"]["requestId"]


def test_unknown_session(client):
    response = submit(client, "sess_doesnotexist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_changed_browser_mid_session_is_flagged(client, clock):
    session = create_session(client)
    clock.advance(seconds=2)
    other = {**BROWSER_HEADERS, "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/131.0"}
    body = submit(client, session["id"], headers=other).json()
    consistency = next(s for s in body["signals"] if s["id"] == "session_consistency")
    assert consistency["status"] == "fail"
    assert body["decision"] != "allow"


def test_missing_telemetry_is_inconclusive_not_fatal(client, clock):
    session = create_session(client)
    clock.advance(seconds=2)
    body = submit(client, session["id"], telemetry=False).json()
    interaction = next(s for s in body["signals"] if s["id"] == "interaction_pattern")
    assert interaction["status"] == "review"


def test_single_step_challenge_is_accessible(client, clock):
    session = create_session(client)
    clock.advance(seconds=3)
    body = submit(
        client,
        session["id"],
        type="single_step",
        inputMethod="assistive",
        holdDurationMs=0,
        telemetry=human_telemetry(pointerType=None, approachMoves=None),
    ).json()
    assert body["decision"] == "allow"


def test_keyboard_hold(client, clock):
    session = create_session(client)
    clock.advance(seconds=2)
    body = submit(
        client,
        session["id"],
        inputMethod="keyboard",
        telemetry=human_telemetry(pointerType=None, keyRepeats=18),
    ).json()
    assert body["decision"] == "allow"


def test_project_policy_is_applied(client, clock):
    signup(client)
    site_key = client.get("/v1/project/settings").json()["siteKey"]
    client.put(
        "/v1/project/settings",
        json={
            "projectName": "Strict",
            "allowThreshold": 0.99,
            "stepUpThreshold": 0.5,
            "retentionDays": "7",
        },
        headers={"Origin": "http://localhost:3000"},
    )
    result = verify_human(client, clock, site_key=site_key)
    assert result["decision"] == "step_up"


def test_invalid_challenge_body(client, clock):
    session = create_session(client)
    response = client.post(
        f"/v1/sessions/{session['id']}/challenge",
        json={"type": "press_hold", "inputMethod": "telepathy", "holdDurationMs": -1},
        headers=BROWSER_HEADERS,
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert {field["path"] for field in error["fields"]} == {"inputMethod", "holdDurationMs"}
