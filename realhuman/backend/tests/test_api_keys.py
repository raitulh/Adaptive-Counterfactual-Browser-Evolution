from __future__ import annotations

from tests.conftest import DASHBOARD_ORIGIN, signup

ORIGIN = {"Origin": DASHBOARD_ORIGIN}


def test_create_list_revoke(client):
    signup(client)
    assert client.get("/v1/api-keys").json() == []
    created = client.post(
        "/v1/api-keys", json={"name": " Production backend ", "environment": "test"}, headers=ORIGIN
    )
    assert created.status_code == 201
    key = created.json()
    assert key["name"] == "Production backend"
    assert key["secret"].startswith("rh_test_sk_") and len(key["secret"]) == 59
    assert key["maskedKey"] == f"rh_test_sk_••••••••{key['secret'][-4:]}"
    assert key["lastUsedAt"] is None

    listed = client.get("/v1/api-keys").json()
    assert len(listed) == 1
    assert "secret" not in listed[0]
    assert key["secret"] not in client.get("/v1/api-keys").text

    assert client.delete(f"/v1/api-keys/{key['id']}", headers=ORIGIN).status_code == 204
    assert client.get("/v1/api-keys").json() == []
    assert client.delete(f"/v1/api-keys/{key['id']}", headers=ORIGIN).status_code == 404


def test_key_name_validation(client):
    signup(client)
    for name in ("x", "bad/name", "ümlaut", "a" * 49):
        response = client.post(
            "/v1/api-keys", json={"name": name, "environment": "live"}, headers=ORIGIN
        )
        assert response.status_code == 422, name
    bad_env = client.post(
        "/v1/api-keys", json={"name": "ok", "environment": "prod"}, headers=ORIGIN
    )
    assert bad_env.status_code == 422


def test_keys_are_private_to_their_project(client):
    signup(client, "one@example.com")
    key = client.post(
        "/v1/api-keys", json={"name": "Mine", "environment": "live"}, headers=ORIGIN
    ).json()
    client.post("/v1/auth/logout", headers=ORIGIN)
    signup(client, "two@example.com")
    assert client.get("/v1/api-keys").json() == []
    assert client.delete(f"/v1/api-keys/{key['id']}", headers=ORIGIN).status_code == 404
