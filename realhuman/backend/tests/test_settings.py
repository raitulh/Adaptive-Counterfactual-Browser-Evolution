from __future__ import annotations

from tests.conftest import DASHBOARD_ORIGIN, signup

ORIGIN = {"Origin": DASHBOARD_ORIGIN}
VALID = {
    "projectName": "Checkout",
    "allowThreshold": 0.85,
    "stepUpThreshold": 0.45,
    "retentionDays": "30",
}


def test_defaults_and_update(client):
    signup(client)
    settings = client.get("/v1/project/settings").json()
    assert settings == {
        "projectName": "Default project",
        "siteKey": settings["siteKey"],
        "allowThreshold": 0.8,
        "stepUpThreshold": 0.5,
        "retentionDays": "7",
    }
    updated = client.put("/v1/project/settings", json=VALID, headers=ORIGIN)
    assert updated.status_code == 200
    assert updated.json() == {**VALID, "siteKey": settings["siteKey"]}
    assert client.get("/v1/project/settings").json()["retentionDays"] == "30"


def test_invalid_settings(client):
    signup(client)
    for overrides in (
        {"stepUpThreshold": 0.9, "allowThreshold": 0.8},
        {"allowThreshold": 0.3},
        {"stepUpThreshold": 0.05},
        {"retentionDays": "14"},
        {"projectName": " x "},
    ):
        response = client.put("/v1/project/settings", json={**VALID, **overrides}, headers=ORIGIN)
        assert response.status_code == 422, overrides
