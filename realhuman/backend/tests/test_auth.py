from __future__ import annotations

from tests.conftest import DASHBOARD_ORIGIN, PASSWORD, signup

ORIGIN = {"Origin": DASHBOARD_ORIGIN}


def test_signup_sets_http_only_cookie_and_creates_project(client):
    response = client.post(
        "/v1/auth/signup", json={"email": "New@Example.com", "password": PASSWORD}, headers=ORIGIN
    )
    assert response.status_code == 201
    assert response.json() == {"email": "new@example.com", "workspace": "new's workspace"}
    cookie = response.headers["set-cookie"]
    assert "rh_session=" in cookie and "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert client.get("/v1/auth/me").json()["email"] == "new@example.com"
    settings = client.get("/v1/project/settings").json()
    assert settings["siteKey"].startswith("pk_live_")


def test_duplicate_signup(client):
    signup(client)
    response = client.post(
        "/v1/auth/signup", json={"email": "dev@example.com", "password": PASSWORD}, headers=ORIGIN
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_signup_validation_never_echoes_password(client):
    response = client.post(
        "/v1/auth/signup", json={"email": "not-an-email", "password": "short"}, headers=ORIGIN
    )
    assert response.status_code == 422
    assert "short" not in response.text
    paths = {field["path"] for field in response.json()["error"]["fields"]}
    assert paths == {"email", "password"}


def test_login_logout(client):
    signup(client)
    client.post("/v1/auth/logout", headers=ORIGIN)
    assert client.get("/v1/auth/me").status_code == 401

    wrong = client.post(
        "/v1/auth/login", json={"email": "dev@example.com", "password": "nope"}, headers=ORIGIN
    )
    assert wrong.status_code == 401
    assert wrong.json()["error"]["code"] == "INVALID_CREDENTIALS"
    unknown = client.post(
        "/v1/auth/login", json={"email": "who@example.com", "password": "nope"}, headers=ORIGIN
    )
    assert unknown.json()["error"]["code"] == "INVALID_CREDENTIALS"

    ok = client.post(
        "/v1/auth/login", json={"email": "DEV@example.com", "password": PASSWORD}, headers=ORIGIN
    )
    assert ok.status_code == 200
    assert client.get("/v1/auth/me").status_code == 200


def test_session_cookie_expires(client, clock):
    signup(client)
    clock.advance(hours=169)
    assert client.get("/v1/auth/me").status_code == 401


def test_dashboard_requires_login(client):
    for path in (
        "/v1/dashboard/overview",
        "/v1/events",
        "/v1/sessions",
        "/v1/logs",
        "/v1/api-keys",
    ):
        response = client.get(path)
        assert response.status_code == 401, path
        assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_untrusted_origin_cannot_write(client):
    signup(client)
    response = client.post(
        "/v1/api-keys",
        json={"name": "Evil", "environment": "live"},
        headers={"Origin": "https://evil.example"},
    )
    assert response.status_code == 403


def test_demo_account_is_seeded(client):
    response = client.post(
        "/v1/auth/login",
        json={"email": "demo@realhuman.dev", "password": "demo-password-123"},
        headers=ORIGIN,
    )
    assert response.status_code == 200
    assert response.json()["workspace"] == "Demo workspace"
    assert client.get("/v1/project/settings").json()["siteKey"] == "pk_test_demo_5f2c81a9e04b"
