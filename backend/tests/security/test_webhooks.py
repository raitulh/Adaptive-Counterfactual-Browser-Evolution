from __future__ import annotations

import json
import time

import pytest

from app.core.config import get_settings
from app.integrations.webhooks import sign

pytestmark = [pytest.mark.security, pytest.mark.integration]


@pytest.fixture
def secret(monkeypatch):
    value = "whsec-test-0123456789"
    monkeypatch.setattr(get_settings(), "webhook_signing_secret", get_settings().webhook_signing_secret.__class__(value))
    return value


async def test_signed_webhook_is_accepted_once(client, secret):
    body = json.dumps({"id": "evt_1_" + str(time.time()), "type": "ping", "data": {}}).encode()
    ts = int(time.time())
    headers = {"X-AgentOS-Timestamp": str(ts), "X-AgentOS-Signature": sign(secret, ts, body),
               "content-type": "application/json"}
    first = await client.post("/api/v1/webhooks/generic", content=body, headers=headers)
    assert first.status_code == 202, first.text
    dup = await client.post("/api/v1/webhooks/generic", content=body, headers=headers)
    assert dup.status_code == 200 and dup.json()["status"] == "duplicate"


async def test_forged_and_replayed_webhooks_rejected(client, secret):
    body = json.dumps({"id": "evt_2", "type": "ping"}).encode()
    ts = int(time.time())
    forged = await client.post("/api/v1/webhooks/generic", content=body,
                               headers={"X-AgentOS-Timestamp": str(ts), "X-AgentOS-Signature": sign("wrong", ts, body)})
    assert forged.status_code == 401
    old = ts - 3600
    replay = await client.post("/api/v1/webhooks/generic", content=body,
                               headers={"X-AgentOS-Timestamp": str(old), "X-AgentOS-Signature": sign(secret, old, body)})
    assert replay.status_code == 401 and replay.json()["error"]["code"] == "webhook_replay"
    missing = await client.post("/api/v1/webhooks/generic", content=body)
    assert missing.status_code == 401


async def test_unconfigured_provider(client):
    resp = await client.post("/api/v1/webhooks/stripe", content=b"{}", headers={"X-AgentOS-Timestamp": "1",
                                                                              "X-AgentOS-Signature": "v1=x"})
    assert resp.status_code == 503
