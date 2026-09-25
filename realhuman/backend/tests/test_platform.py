"""CORS, rate limiting, error envelope, health, contact, request IDs."""

from __future__ import annotations

from app.security.rate_limit import RateLimiter
from tests.conftest import BROWSER_HEADERS, DASHBOARD_ORIGIN, DEMO_SITE_KEY, signup


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {"status": "ok"}


def test_unknown_route_uses_envelope(client):
    response = client.get("/v1/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
    assert response.json()["error"]["requestId"].startswith("req_")


def test_request_id_is_echoed_when_valid(client):
    response = client.get("/healthz", headers={"X-Request-ID": "trace-1234abcd"})
    assert response.headers["x-request-id"] == "trace-1234abcd"
    generated = client.get("/healthz", headers={"X-Request-ID": "<script>"})
    assert generated.headers["x-request-id"].startswith("req_")


def test_cors_trusted_origin_with_credentials(client):
    preflight = client.options(
        "/v1/api-keys",
        headers={
            "Origin": DASHBOARD_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type, x-evil",
        },
    )
    assert preflight.status_code == 204
    assert preflight.headers["access-control-allow-origin"] == DASHBOARD_ORIGIN
    assert preflight.headers["access-control-allow-credentials"] == "true"
    assert preflight.headers["access-control-allow-headers"] == "content-type"

    response = client.get("/v1/auth/me", headers={"Origin": DASHBOARD_ORIGIN})
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == DASHBOARD_ORIGIN
    assert "X-Request-ID" in response.headers["access-control-expose-headers"]


def test_cors_public_widget_from_any_origin(client):
    origin = "https://shop.customer.example"
    preflight = client.options(
        "/v1/sessions",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST"},
    )
    assert preflight.status_code == 204
    assert preflight.headers["access-control-allow-origin"] == origin
    assert "access-control-allow-credentials" not in preflight.headers

    created = client.post(
        "/v1/sessions",
        json={"siteKey": DEMO_SITE_KEY},
        headers={**BROWSER_HEADERS, "Origin": origin},
    )
    assert created.status_code == 201
    assert created.headers["access-control-allow-origin"] == origin


def test_cors_never_exposes_dashboard_data_to_other_origins(client):
    signup(client)
    origin = "https://evil.example"
    response = client.get("/v1/sessions", headers={"Origin": origin})
    assert "access-control-allow-origin" not in response.headers
    preflight = client.options(
        "/v1/sessions", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )
    assert preflight.status_code == 403


def test_rate_limit_returns_429_with_retry_after(client, app):
    app.state.settings.rate_limit_sessions_per_minute = 2
    for _ in range(2):
        assert (
            client.post(
                "/v1/sessions", json={"siteKey": DEMO_SITE_KEY}, headers=BROWSER_HEADERS
            ).status_code
            == 201
        )
    limited = client.post("/v1/sessions", json={"siteKey": DEMO_SITE_KEY}, headers=BROWSER_HEADERS)
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMITED"
    assert int(limited.headers["retry-after"]) >= 1


def test_rate_limiter_window():
    now = [0.0]
    limiter = RateLimiter(clock=lambda: now[0])
    assert limiter.hit("k", 2, 10) == (True, 0)
    assert limiter.hit("k", 2, 10) == (True, 0)
    assert limiter.hit("k", 2, 10) == (False, 10)
    now[0] = 10.5
    assert limiter.hit("k", 2, 10) == (True, 0)


def test_rate_limiter_is_bounded():
    limiter = RateLimiter(clock=lambda: 0.0, max_keys=10)
    for index in range(100):
        limiter.hit(f"k{index}", 5, 60)
    assert len(limiter._hits) <= 10


def test_contact(client):
    response = client.post(
        "/v1/contact",
        json={"name": "Ada", "email": "ada@example.com", "company": "", "message": "Hi"},
        headers=BROWSER_HEADERS,
    )
    assert response.status_code == 200
    assert response.json() == {"received": True}
    invalid = client.post("/v1/contact", json={"name": "A", "email": "x"}, headers=BROWSER_HEADERS)
    assert invalid.status_code == 422


def test_unhandled_errors_become_envelopes(app, client):
    def boom(request):
        raise RuntimeError("secret internals")

    app.add_route("/boom", boom)
    response = client.get("/boom", headers={"Origin": DASHBOARD_ORIGIN})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "SERVER_ERROR"
    assert "secret internals" not in response.text
    assert response.headers["access-control-allow-origin"] == DASHBOARD_ORIGIN
    assert response.headers["x-request-id"] == response.json()["error"]["requestId"]
