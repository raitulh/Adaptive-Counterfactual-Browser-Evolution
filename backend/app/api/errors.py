"""Global exception handlers rendering the stable error envelope."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.orm.exc import StaleDataError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.config import get_settings
from app.core.exceptions import AppError, RateLimited
from app.core.logging import request_id_var
from app.core.telemetry import get_error_reporter

logger = logging.getLogger(__name__)


def error_payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "error": {
            "code": code,
            "message": message,
            "request_id": request_id_var.get(),
            "details": details or {},
        }
    }


class ErrorResponse(dict):  # pragma: no cover - documentation helper
    pass


def _sanitize_validation_errors(errors: list[Any]) -> list[dict[str, Any]]:
    out = []
    for err in errors[:50]:
        out.append(
            {
                "loc": [str(p) for p in err.get("loc", [])],
                "msg": str(err.get("msg", ""))[:300],
                "type": str(err.get("type", "")),
            }
        )
    return out


def install_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def _app_error(request: Request, exc: AppError) -> JSONResponse:
        headers: dict[str, str] = {}
        if isinstance(exc, RateLimited):
            headers["Retry-After"] = str(exc.retry_after)
            if exc.limit is not None:
                headers["RateLimit-Limit"] = str(exc.limit)
                headers["RateLimit-Remaining"] = "0"
                headers["RateLimit-Reset"] = str(exc.retry_after)
        if exc.status_code >= 500:
            logger.error("app_error", extra={"code": exc.code, "error_message": exc.message})
        return JSONResponse(error_payload(exc.code, exc.message, exc.details), status_code=exc.status_code,
                            headers=headers)

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            error_payload("validation_failed", "The request is invalid.",
                          {"errors": _sanitize_validation_errors(list(exc.errors()))}),
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {
            400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found",
            405: "method_not_allowed", 409: "conflict", 413: "payload_too_large", 415: "unsupported_media_type",
            429: "rate_limited",
        }.get(exc.status_code, "http_error")
        message = exc.detail if isinstance(exc.detail, str) else "Request failed."
        return JSONResponse(error_payload(code, message), status_code=exc.status_code,
                            headers=getattr(exc, "headers", None))

    @app.exception_handler(StaleDataError)
    async def _stale(request: Request, exc: StaleDataError) -> JSONResponse:
        return JSONResponse(
            error_payload("concurrent_modification", "The resource was modified concurrently; retry."),
            status_code=409,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        get_error_reporter().capture(exc, path=request.url.path)
        settings = get_settings()
        details: dict[str, Any] = {}
        if settings.debug and not settings.is_production:
            details["exception"] = type(exc).__name__
        return JSONResponse(error_payload("internal_error", "An internal error occurred.", details),
                            status_code=500)
