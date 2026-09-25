from __future__ import annotations

from tests.conftest import DASHBOARD_ORIGIN, signup, verify_human


def _secret_key(client, environment: str = "live") -> str:
    response = client.post(
        "/v1/api-keys",
        json={"name": "Backend", "environment": environment},
        headers={"Origin": DASHBOARD_ORIGIN},
    )
    assert response.status_code == 201, response.text
    return response.json()["secret"]


def _site_key(client) -> str:
    return client.get("/v1/project/settings").json()["siteKey"]


def test_token_redeems_once(client, clock):
    signup(client)
    secret = _secret_key(client)
    result = verify_human(client, clock, site_key=_site_key(client), action="checkout")

    response = client.post(
        "/v1/verify",
        json={"token": result["token"]},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["session"] == result["sessionId"]
    assert body["verified"] is True
    assert body["decision"] == "allow"
    assert body["action"] == "checkout"
    assert len(body["signals"]) == 4
    assert body["redeemedAt"].endswith("Z")

    again = client.post(
        "/v1/verify",
        json={"token": result["token"]},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert again.status_code == 410
    assert "already been redeemed" in again.json()["error"]["message"]

    keys = client.get("/v1/api-keys").json()
    assert keys[0]["lastUsedAt"] is not None


def test_token_expires(client, clock):
    signup(client)
    secret = _secret_key(client)
    result = verify_human(client, clock, site_key=_site_key(client))
    clock.advance(seconds=301)
    response = client.post(
        "/v1/verify",
        json={"token": result["token"]},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert response.status_code == 410


def test_token_from_another_project_is_unknown(client, clock):
    signup(client)
    secret = _secret_key(client)
    # The demo project's token cannot be redeemed with this project's key.
    result = verify_human(client, clock)
    response = client.post(
        "/v1/verify",
        json={"token": result["token"]},
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert response.status_code == 404


def test_verify_requires_a_valid_key(client, clock):
    signup(client)
    secret = _secret_key(client)
    assert client.post("/v1/verify", json={"token": "x"}).status_code == 401
    bad = client.post(
        "/v1/verify", json={"token": "x"}, headers={"Authorization": "Bearer rh_live_sk_wrong"}
    )
    assert bad.status_code == 401
    key_id = client.get("/v1/api-keys").json()[0]["id"]
    client.delete(f"/v1/api-keys/{key_id}", headers={"Origin": DASHBOARD_ORIGIN})
    revoked = client.post(
        "/v1/verify", json={"token": "x"}, headers={"Authorization": f"Bearer {secret}"}
    )
    assert revoked.status_code == 401
