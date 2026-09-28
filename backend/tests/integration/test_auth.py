from __future__ import annotations

import pytest

pytestmark = pytest.mark.integration


async def test_register_login_refresh_rotation_and_reuse_detection(client, make_user):
    user = await make_user()
    me = await client.get("/api/v1/users/me", headers=user.headers)
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["email"] == user.email
    assert "tasks:create" in body["permissions"]
    assert body["role"] == "owner"

    login = await client.post("/api/v1/auth/login", json={"email": user.email, "password": user.password})
    assert login.status_code == 200, login.text
    tokens = login.json()
    r1 = tokens["refresh_token"]

    rotated = await client.post("/api/v1/auth/refresh", json={"refresh_token": r1})
    assert rotated.status_code == 200, rotated.text
    r2 = rotated.json()["refresh_token"]
    assert r2 != r1

    # Replaying the already-used token revokes the whole session family.
    replay = await client.post("/api/v1/auth/refresh", json={"refresh_token": r1})
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "refresh_token_reused"
    after = await client.post("/api/v1/auth/refresh", json={"refresh_token": r2})
    assert after.status_code == 401

    # The access token of the revoked session no longer works.
    revoked_access = await client.get("/api/v1/users/me",
                                      headers={"Authorization": f"Bearer {rotated.json()['access_token']}"})
    assert revoked_access.status_code == 401


async def test_login_failures_are_uniform_and_lock_account(client, make_user):
    user = await make_user()
    for _ in range(5):
        bad = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong-Passw0rd!"})
        assert bad.status_code == 401
        assert bad.json()["error"]["code"] == "invalid_credentials"
    locked = await client.post("/api/v1/auth/login", json={"email": user.email, "password": user.password})
    assert locked.status_code == 401  # locked out even with the right password
    unknown = await client.post("/api/v1/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert unknown.status_code == 401
    assert unknown.json()["error"]["code"] == "invalid_credentials"


async def test_logout_revokes_session(client, make_user):
    user = await make_user()
    out = await client.post("/api/v1/auth/logout", headers=user.headers)
    assert out.status_code == 204
    again = await client.get("/api/v1/users/me", headers=user.headers)
    assert again.status_code == 401


async def test_missing_and_malformed_tokens(client):
    assert (await client.get("/api/v1/users/me")).status_code == 401
    bad = await client.get("/api/v1/users/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "invalid_token"
    assert "request_id" in bad.json()["error"]


async def test_weak_password_rejected(client):
    resp = await client.post("/api/v1/auth/register", json={"email": "weak@example.com", "password": "password123"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_failed"
