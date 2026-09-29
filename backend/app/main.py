"""AgentOS API application factory."""

from __future__ import annotations

import contextlib
import logging
from collections.abc import AsyncIterator
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.errors import install_exception_handlers
from app.api.router import build_api_router
from app.core.config import Settings, get_settings
from app.core.database import dispose_engine
from app.core.exceptions import Unauthorized
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware, SecurityHeadersMiddleware
from app.core.redis import close_redis
from app.core.security import constant_time_equals
from app.core.telemetry import configure_error_reporting, configure_tracing

logger = logging.getLogger(__name__)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    logger.info("startup", extra={"env": settings.app_env.value, "version": settings.app_version})
    from app.tools.registry import get_tool_registry

    get_tool_registry()  # load and self-check built-in tool definitions at startup
    yield
    await close_redis()
    await dispose_engine()
    logger.info("shutdown")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.validate_for_startup()
    configure_logging(settings.log_level, settings.log_json)
    configure_tracing(settings)
    configure_error_reporting(settings)

    app = FastAPI(
        title=f"{settings.app_name} API",
        version=settings.app_version,
        description=(
            "AgentOS: an action-taking, tool-using, self-verifying AI agent platform. "
            "LLM proposes. Backend decides. Tools execute. Verifier confirms.\n\n"
            "All endpoints except auth and health require `Authorization: Bearer <access token>`. "
            "Errors use the envelope `{\"error\": {\"code\", \"message\", \"request_id\", \"details\"}}`."
        ),
        lifespan=lifespan,
        docs_url="/docs" if settings.expose_openapi else None,
        redoc_url="/redoc" if settings.expose_openapi else None,
        openapi_url=f"{settings.api_prefix}/openapi.json" if settings.expose_openapi else None,
    )
    app.state.settings = settings

    # Middleware (last added = outermost).
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes,
                       overrides={f"{settings.api_prefix}/files": settings.file_max_upload_bytes + 64 * 1024})
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Idempotency-Key", "X-Request-ID", "X-CSRF-Token",
                       "Last-Event-ID"],
        expose_headers=["X-Request-ID", "Idempotent-Replayed", "RateLimit-Limit", "RateLimit-Remaining",
                        "RateLimit-Reset", "Retry-After"],
        max_age=600,
    )
    if settings.trusted_hosts and settings.trusted_hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    app.add_middleware(SecurityHeadersMiddleware, settings=settings)
    app.add_middleware(RequestContextMiddleware)

    install_exception_handlers(app)
    app.include_router(build_api_router(), prefix=settings.api_prefix)

    base_openapi = app.openapi

    def openapi_with_contract_enums() -> dict[str, Any]:
        if app.openapi_schema is None:
            from app.api.contract import add_contract_enums

            app.openapi_schema = add_contract_enums(base_openapi())
        return app.openapi_schema

    app.openapi = openapi_with_contract_enums  # type: ignore[method-assign]

    if settings.metrics_enabled:
        @app.get("/metrics", include_in_schema=False)
        async def metrics(request: Request) -> Response:
            token = settings.metrics_bearer_token.get_secret_value()
            if token:
                header = request.headers.get("authorization", "")
                if not constant_time_equals(header, f"Bearer {token}"):
                    raise Unauthorized("Metrics require a bearer token")
            return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


def app_factory() -> FastAPI:  # uvicorn --factory app.main:app_factory
    return create_app()
