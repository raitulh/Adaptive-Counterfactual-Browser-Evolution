from __future__ import annotations

import hashlib
import hmac
import json

import httpx

from app.services.webhook_service import WebhookDispatcher
from tests.conftest import DASHBOARD_ORIGIN, signup, verify_human

ORIGIN = {"Origin": DASHBOARD_ORIGIN}


def _site_key(client) -> str:
    return client.get("/v1/project/settings").json()["siteKey"]


def _dispatcher(app, clock, handler) -> WebhookDispatcher:
    return WebhookDispatcher(
        app.state.session_factory,
        app.state.settings,
        app.state.secret_box,
        clock,
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        resolver=lambda host, port: ["93.184.215.14"],
    )


def test_create_list_delete(client):
    signup(client)
    created = client.post(
        "/v1/webhooks",
        json={"url": "https://hooks.example.com/rh", "events": ["verification.completed"]},
        headers=ORIGIN,
    )
    assert created.status_code == 201
    endpoint = created.json()
    assert endpoint["status"] == "active"
    assert endpoint["signingSecret"].startswith("whsec_")
    listed = client.get("/v1/webhooks").json()
    assert listed == [{k: v for k, v in endpoint.items() if k != "signingSecret"}]
    assert client.delete(f"/v1/webhooks/{endpoint['id']}", headers=ORIGIN).status_code == 204
    assert client.get("/v1/webhooks").json() == []
    assert client.delete(f"/v1/webhooks/{endpoint['id']}", headers=ORIGIN).status_code == 404


def test_rejects_unsafe_urls(client):
    signup(client)
    for url in (
        "http://hooks.example.com",
        "https://localhost/hook",
        "https://127.0.0.1/hook",
        "https://10.0.0.8/hook",
        "https://user:pass@hooks.example.com/",
        "ftp://example.com",
    ):
        response = client.post(
            "/v1/webhooks", json={"url": url, "events": ["session.expired"]}, headers=ORIGIN
        )
        assert response.status_code == 422, url
    empty = client.post(
        "/v1/webhooks", json={"url": "https://hooks.example.com", "events": []}, headers=ORIGIN
    )
    assert empty.status_code == 422


def test_signed_delivery_and_retry(client, app, clock):
    signup(client)
    endpoint = client.post(
        "/v1/webhooks",
        json={"url": "https://hooks.example.com/rh", "events": ["verification.completed"]},
        headers=ORIGIN,
    ).json()
    result = verify_human(client, clock, site_key=_site_key(client))

    received: list[httpx.Request] = []
    statuses = iter([500, 204])

    def handler(request: httpx.Request) -> httpx.Response:
        received.append(request)
        return httpx.Response(next(statuses))

    dispatcher = _dispatcher(app, clock, handler)
    assert dispatcher.run_once() == 1  # fails with 500 → scheduled for retry
    assert dispatcher.run_once() == 0  # not due yet
    clock.advance(seconds=11)
    assert dispatcher.run_once() == 1  # succeeds
    assert dispatcher.run_once() == 0

    request = received[-1]
    body = request.content
    payload = json.loads(body)
    assert payload["type"] == "verification.completed"
    assert payload["data"]["sessionId"] == result["sessionId"]
    assert payload["data"]["outcome"] == "verified"
    assert request.headers["RealHuman-Event"] == "verification.completed"

    timestamp, signature = (
        part.split("=", 1)[1] for part in request.headers["RealHuman-Signature"].split(",")
    )
    expected = hmac.new(
        endpoint["signingSecret"].encode(), f"{timestamp}.".encode() + body, hashlib.sha256
    ).hexdigest()
    assert hmac.compare_digest(signature, expected)

    from app.models import WebhookDelivery

    with app.state.session_factory() as db:
        delivery = db.query(WebhookDelivery).one()
        assert delivery.status == "succeeded" and delivery.attempts == 2


def test_only_subscribed_events_are_delivered(client, app, clock):
    signup(client)
    client.post(
        "/v1/webhooks",
        json={"url": "https://hooks.example.com/rh", "events": ["verification.blocked"]},
        headers=ORIGIN,
    )
    verify_human(client, clock, site_key=_site_key(client))
    dispatcher = _dispatcher(app, clock, lambda request: httpx.Response(200))
    assert dispatcher.run_once() == 0


def test_private_resolution_is_blocked_at_delivery(client, app, clock):
    signup(client)
    client.post(
        "/v1/webhooks",
        json={"url": "https://rebind.example.com/rh", "events": ["verification.completed"]},
        headers=ORIGIN,
    )
    verify_human(client, clock, site_key=_site_key(client))
    calls = []
    dispatcher = WebhookDispatcher(
        app.state.session_factory,
        app.state.settings,
        app.state.secret_box,
        clock,
        client=httpx.Client(transport=httpx.MockTransport(lambda r: calls.append(r))),
        resolver=lambda host, port: ["169.254.169.254"],
    )
    assert dispatcher.run_once() == 1
    assert calls == []
    from app.models import WebhookDelivery

    with app.state.session_factory() as db:
        delivery = db.query(WebhookDelivery).one()
        assert delivery.status == "pending" and "non-public" in delivery.last_error


def test_gives_up_after_max_attempts(client, app, clock):
    app.state.settings.webhook_max_attempts = 2
    signup(client)
    client.post(
        "/v1/webhooks",
        json={"url": "https://hooks.example.com/rh", "events": ["verification.completed"]},
        headers=ORIGIN,
    )
    verify_human(client, clock, site_key=_site_key(client))
    dispatcher = _dispatcher(app, clock, lambda request: httpx.Response(503))
    dispatcher.run_once()
    clock.advance(seconds=61)
    dispatcher.run_once()
    from app.models import WebhookDelivery

    with app.state.session_factory() as db:
        delivery = db.query(WebhookDelivery).one()
        assert delivery.status == "failed" and delivery.last_status_code == 503
