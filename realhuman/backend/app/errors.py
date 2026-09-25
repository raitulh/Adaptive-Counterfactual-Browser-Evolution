"""
Error envelope shared with the frontend: `{ "error": { "code", "message", "requestId" } }`.
Codes match `apiErrorCodeSchema` in the web app. Messages are safe to display
and never contain request payloads.
"""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("realhuman.errors")

DEFAULT_MESSAGES: dict[str, str] = {
    "SESSION_EXPIRED": "This verification session expired before it was completed.",
    "RATE_LIMITED": "Too many requests. Wait a moment and try again.",
    "UNAUTHORIZED": "You need to sign in to continue.",
    "INVALID_CREDENTIALS": "That email and password combination didn't work.",
    "VALIDATION_ERROR": "Some of the submitted information is invalid.",
    "NOT_FOUND": "The requested resource was not found.",
    "SERVER_ERROR": "The service ran into a problem. Try again shortly.",
    "UNKNOWN": "Something went wrong.",
}


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str | None = None,
        *,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message or DEFAULT_MESSAGES.get(code, DEFAULT_MESSAGES["UNKNOWN"])
        self.headers = headers
        super().__init__(self.message)


def code_for_status(status: int) -> str:
    if status in (401, 403):
        return "UNAUTHORIZED"
    if status == 404:
        return "NOT_FOUND"
    if status == 410:
        return "SESSION_EXPIRED"
    if status in (400, 405, 409, 413, 415, 422):
        return "VALIDATION_ERROR"
    if status == 429:
        return "RATE_LIMITED"
    if status >= 500:
        return "SERVER_ERROR"
    return "UNKNOWN"


def request_id_of(request: Request) -> str:
    return getattr(request.state, "request_id", "") or ""


def error_response(
    request: Request,
    status_code: int,
    code: str,
    message: str,
    *,
    headers: dict[str, str] | None = None,
    extra: dict | None = None,
) -> JSONResponse:
    request_id = request_id_of(request)
    body = {"error": {"code": code, "message": message, "requestId": request_id, **(extra or {})}}
    return JSONResponse(
        body, status_code=status_code, headers={**(headers or {}), "X-Request-ID": request_id}
    )


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(request, exc.status_code, exc.code, exc.message, headers=exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = code_for_status(exc.status_code)
        return error_response(
            request,
            exc.status_code,
            code,
            DEFAULT_MESSAGES.get(code, DEFAULT_MESSAGES["UNKNOWN"]),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Field paths and messages only — FastAPI's default echoes the input,
        # which could include passwords.
        fields = [
            {
                "path": ".".join(str(part) for part in error.get("loc", ()) if part != "body"),
                "message": str(error.get("msg", "Invalid value.")).removeprefix("Value error, "),
            }
            for error in exc.errors()
        ]
        return error_response(
            request,
            422,
            "VALIDATION_ERROR",
            DEFAULT_MESSAGES["VALIDATION_ERROR"],
            extra={"fields": fields},
        )
