"""Pure-ASGI middleware (safe for streaming/SSE responses).

* RequestContextMiddleware – request IDs, correlation context, access log,
  metrics and a server span per request.
* SecurityHeadersMiddleware – conservative security headers for a JSON API.
* BodySizeLimitMiddleware – rejects oversized bodies before they are buffered.
"""

from __future__ import annotations

import json
import logging
import re
import time
import uuid
from typing import Any

from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core import metrics
from app.core.config import Settings
from app.core.logging import request_id_var
from app.core.telemetry import span

logger = logging.getLogger("agentos.access")
_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")


def _route_template(scope: Scope) -> str:
    route = scope.get("route")
    path = getattr(route, "path", None)
    return path or "unmatched"


def _error_body(code: str, message: str, request_id: str, status: int) -> tuple[bytes, list[tuple[bytes, bytes]]]:
    body = json.dumps(
        {"error": {"code": code, "message": message, "request_id": request_id, "details": {}}}
    ).encode()
    headers = [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(body)).encode()),
        (b"x-request-id", request_id.encode()),
    ]
    return body, headers


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers") or [])
        incoming = headers.get(b"x-request-id", b"").decode("latin-1")
        request_id = incoming if _REQUEST_ID_RE.match(incoming) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        status_holder: dict[str, int] = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                raw_headers = list(message.get("headers", []))
                raw_headers.append((b"x-request-id", request_id.encode()))
                message["headers"] = raw_headers
            await send(message)

        method = scope.get("method", "GET")
        try:
            with span("http.request", **{"http.method": method, "http.target": scope.get("path", "")}):
                await self.app(scope, receive, send_wrapper)
        finally:
            elapsed = time.perf_counter() - started
            route = _route_template(scope)
            status = status_holder["status"]
            metrics.api_requests_total.labels(method, route, str(status)).inc()
            metrics.api_latency.labels(method, route).observe(elapsed)
            if route not in ("/api/v1/live", "/api/v1/ready", "/metrics"):
                logger.info(
                    "request",
                    extra={
                        "http_method": method,
                        "route": route,
                        "status": status,
                        "duration_ms": round(elapsed * 1000, 2),
                    },
                )
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, settings: Settings) -> None:
        self.app = app
        self.hsts = settings.is_production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path: str = scope.get("path", "")
        is_docs = path.startswith("/docs") or path.startswith("/redoc")

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                h = list(message.get("headers", []))
                h += [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
                    (b"cross-origin-opener-policy", b"same-origin"),
                    (b"cache-control", b"no-store"),
                ]
                if not is_docs:
                    h.append((b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"))
                if self.hsts:
                    h.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                message["headers"] = h
            await send(message)

        await self.app(scope, receive, send_wrapper)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int, overrides: dict[str, int] | None = None) -> None:
        self.app = app
        self.max_bytes = max_bytes
        self.overrides = overrides or {}

    def _limit_for(self, path: str) -> int:
        for prefix, limit in self.overrides.items():
            if path.startswith(prefix):
                return limit
        return self.max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = self._limit_for(scope.get("path", ""))
        headers = dict(scope.get("headers") or [])
        request_id = scope.get("state", {}).get("request_id", "")
        length = headers.get(b"content-length")
        if length is not None:
            try:
                too_big = int(length) > limit
            except ValueError:
                too_big = True
            if too_big:
                body, hdrs = _error_body("payload_too_large", "Request payload is too large.", request_id, 413)
                await send({"type": "http.response.start", "status": 413, "headers": hdrs})
                await send({"type": "http.response.body", "body": body})
                return

        received = 0
        exceeded = False

        async def limited_receive() -> Message:
            nonlocal received, exceeded
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    exceeded = True
                    raise _BodyTooLarge()
            return message

        response_started = False

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not response_started:
                body, hdrs = _error_body("payload_too_large", "Request payload is too large.", request_id, 413)
                await send({"type": "http.response.start", "status": 413, "headers": hdrs})
                await send({"type": "http.response.body", "body": body})


class _BodyTooLarge(StarletteHTTPException):
    """Raised from ``receive`` for chunked bodies that exceed the limit. Being an
    HTTPException, FastAPI re-raises it unchanged and the API error handler renders
    the standard 413 envelope."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="Request payload is too large.")


def client_ip(scope_or_request: Any) -> str:
    """Best-effort client IP. Behind a proxy, configure uvicorn --proxy-headers with
    --forwarded-allow-ips so ``client`` is already the real address."""
    client = getattr(scope_or_request, "client", None)
    if client is not None:
        return client.host or "unknown"
    return "unknown"
