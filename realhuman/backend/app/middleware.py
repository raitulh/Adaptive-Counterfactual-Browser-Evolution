"""ASGI middleware: request IDs, request logging, crash safety net and CORS."""

from __future__ import annotations

import logging
import re
import secrets
import time
from collections.abc import Iterable

from starlette.concurrency import run_in_threadpool
from starlette.datastructures import Headers, MutableHeaders
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import DEFAULT_MESSAGES
from app.models import RequestLog

logger = logging.getLogger("realhuman.http")

_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{8,64}$")
# The widget calls these from any site; everything else is the dashboard.
_PUBLIC_WIDGET_PATH = re.compile(r"^/v1/sessions(/[^/]+/challenge)?/?$")
_ALLOWED_REQUEST_HEADERS = {"accept", "content-type", "authorization", "x-request-id"}
_EXPOSED_HEADERS = "X-Request-ID, Retry-After"


class RequestContextMiddleware:
    """
    Assigns a request ID, logs one line per request (never payloads), records
    verification API calls to the project's request log, and turns unhandled
    exceptions into the standard error envelope *inside* CORS, so browsers can
    still read a 500.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        state = scope.setdefault("state", {})
        incoming = Headers(scope=scope).get("x-request-id", "")
        request_id = incoming if _REQUEST_ID.match(incoming) else f"req_{secrets.token_hex(8)}"
        state["request_id"] = request_id
        started = time.perf_counter()
        response_state = {"status": 500, "started": False}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_state["status"] = message["status"]
                response_state["started"] = True
                headers = MutableHeaders(scope=message)
                if "x-request-id" not in headers:
                    headers.append("X-Request-ID", request_id)
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception(
                "unhandled error", extra={"request_id": request_id, "path": scope["path"]}
            )
            if response_state["started"]:
                raise
            body = {
                "error": {
                    "code": "SERVER_ERROR",
                    "message": DEFAULT_MESSAGES["SERVER_ERROR"],
                    "requestId": request_id,
                }
            }
            await JSONResponse(body, status_code=500)(scope, receive, send_wrapper)

        latency_ms = int((time.perf_counter() - started) * 1000)
        status = response_state["status"]
        logger.info(
            "%s %s %s %sms",
            scope["method"],
            scope["path"],
            status,
            latency_ms,
            extra={"request_id": request_id},
        )
        project_id = state.get("log_project_id")
        if project_id:
            app = scope.get("app")
            await run_in_threadpool(
                _write_request_log,
                app,
                project_id,
                scope["method"],
                scope["path"],
                status,
                latency_ms,
                request_id,
            )


def _write_request_log(
    app, project_id: str, method: str, path: str, status: int, latency_ms: int, request_id: str
) -> None:
    try:
        with app.state.session_factory() as db:
            db.add(
                RequestLog(
                    project_id=project_id,
                    method=method,
                    path=path[:255],
                    status=status,
                    latency_ms=latency_ms,
                    request_id=request_id,
                    created_at=app.state.clock.now(),
                )
            )
            db.commit()
    except Exception:  # logging must never break a request
        logger.exception("could not write request log", extra={"request_id": request_id})


class CorsMiddleware:
    """
    Two CORS policies:

    - trusted origins (the dashboard) may call everything, with credentials;
    - any other origin may call only the public widget endpoints
      (`POST /v1/sessions`, `POST /v1/sessions/{id}/challenge`), without
      credentials, so the widget can be embedded on customer sites.

    Method-aware on purpose: `GET /v1/sessions` (dashboard data) shares its path
    with the public `POST` and must never be readable cross-origin.
    """

    def __init__(
        self, app: ASGIApp, *, trusted_origins: Iterable[str], public_any_origin: bool
    ) -> None:
        self.app = app
        self.trusted = {origin.rstrip("/") for origin in trusted_origins}
        self.public_any_origin = public_any_origin

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        if not origin:
            await self.app(scope, receive, send)
            return

        method = scope["method"].upper()
        preflight = method == "OPTIONS" and "access-control-request-method" in headers
        target_method = headers["access-control-request-method"].upper() if preflight else method
        trusted = origin.rstrip("/") in self.trusted
        public = (
            self.public_any_origin
            and target_method == "POST"
            and bool(_PUBLIC_WIDGET_PATH.match(scope["path"]))
        )

        if not trusted and not public:
            if preflight:
                await PlainTextResponse("Origin not allowed.", status_code=403)(
                    scope, receive, send
                )
            else:
                await self.app(scope, receive, _add_vary(send))
            return

        cors = {"Access-Control-Allow-Origin": origin}
        if trusted:
            cors["Access-Control-Allow-Credentials"] = "true"

        if preflight:
            requested = headers.get("access-control-request-headers", "")
            allowed = [
                name.strip()
                for name in requested.split(",")
                if name.strip().lower() in _ALLOWED_REQUEST_HEADERS
            ]
            cors |= {
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE" if trusted else "POST",
                "Access-Control-Allow-Headers": ", ".join(allowed),
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            }
            await Response(status_code=204, headers=cors)(scope, receive, send)
            return

        cors["Access-Control-Expose-Headers"] = _EXPOSED_HEADERS

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                response_headers = MutableHeaders(scope=message)
                for key, value in cors.items():
                    response_headers[key] = value
                response_headers.add_vary_header("Origin")
            await send(message)

        await self.app(scope, receive, send_with_cors)


def _add_vary(send: Send) -> Send:
    async def wrapped(message: Message) -> None:
        if message["type"] == "http.response.start":
            MutableHeaders(scope=message).add_vary_header("Origin")
        await send(message)

    return wrapped
