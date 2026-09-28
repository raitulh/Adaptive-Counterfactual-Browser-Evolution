from __future__ import annotations

import pytest

from app.security.ratelimit import get_rate_limiter

pytestmark = [pytest.mark.security, pytest.mark.integration]


async def test_stream_token_is_not_an_access_token(client, make_user):
    user = await make_user()
    token = (await client.post("/api/v1/auth/stream-token", headers=user.headers)).json()["token"]
    assert (await client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})).status_code == 401
    # and full access tokens are never accepted in URLs
    resp = await client.get("/api/v1/tasks/00000000-0000-0000-0000-000000000000/events/stream",
                            params={"access_token": user.access_token})
    assert resp.status_code == 401


async def test_cookie_refresh_requires_csrf_token(client, make_user):
    user = await make_user()
    login = await client.post("/api/v1/auth/login", json={"email": user.email, "password": user.password,
                                                          "token_delivery": "cookie"})
    assert login.status_code == 200 and login.json()["refresh_token"] is None
    assert "httponly" in login.headers.get("set-cookie", "").lower()
    refresh_cookie = client.cookies.get("agentos_refresh")
    csrf = client.cookies.get("agentos_csrf")
    assert refresh_cookie and csrf
    no_csrf = await client.post("/api/v1/auth/refresh", cookies={"agentos_refresh": refresh_cookie})
    assert no_csrf.status_code == 401 and no_csrf.json()["error"]["code"] == "csrf_failed"
    ok = await client.post("/api/v1/auth/refresh", headers={"X-CSRF-Token": csrf},
                           cookies={"agentos_refresh": refresh_cookie, "agentos_csrf": csrf})
    assert ok.status_code == 200, ok.text


async def test_login_rate_limit_returns_standard_429(client, make_user, monkeypatch):
    user = await make_user()
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "rate_limit_auth_per_minute", 3)
    statuses = []
    for _ in range(5):
        r = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-Passw0rd!"})
        statuses.append(r.status_code)
    assert 429 in statuses
    limited = r
    assert limited.status_code == 429
    assert "retry-after" in limited.headers and limited.json()["error"]["code"] == "rate_limited"


async def test_security_headers_and_request_ids(client):
    resp = await client.get("/api/v1/live", headers={"X-Request-ID": "client-supplied-id-123"})
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["x-frame-options"] == "DENY"
    assert resp.headers["x-request-id"] == "client-supplied-id-123"
    bad = await client.get("/api/v1/live", headers={"X-Request-ID": "bad id with spaces"})
    assert bad.headers["x-request-id"] != "bad id with spaces"


async def test_oversized_body_rejected(client, make_user):
    user = await make_user()
    resp = await client.post("/api/v1/tasks", content=b"{" + b" " * (3 * 1024 * 1024) + b"}",
                             headers={**user.headers, "content-type": "application/json"})
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "payload_too_large"


async def test_rate_limiter_sliding_window():
    limiter = get_rate_limiter()
    ident = "unit-test-ident"
    results = [await limiter.hit("unit", ident, 3, 60) for _ in range(5)]
    assert [r.allowed for r in results] == [True, True, True, False, False]
    assert results[-1].remaining == 0 and results[-1].reset_seconds > 0


async def test_disabled_user_cannot_use_existing_token(client, make_user, db_session):
    from app.users.models import User

    user = await make_user()
    u = await db_session.get(User, user.user_id)
    u.status = "disabled"
    await db_session.commit()
    assert (await client.get("/api/v1/users/me", headers=user.headers)).status_code == 401
