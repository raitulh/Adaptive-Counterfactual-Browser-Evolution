"""
RealHuman API — FastAPI application factory.

Run locally:   uvicorn app.main:app --reload
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api import (
    api_keys,
    auth,
    contact,
    dashboard,
    health,
    sessions,
    verify,
    webhooks,
)
from app.api import (
    settings as project_settings,
)
from app.clock import Clock
from app.config import Settings, get_settings
from app.db.database import create_db_engine, create_session_factory
from app.errors import register_error_handlers
from app.logging_config import configure_logging
from app.middleware import CorsMiddleware, RequestContextMiddleware
from app.security.crypto import Pseudonymizer, SecretBox
from app.security.rate_limit import RateLimiter
from app.services.network import NetworkClassifier
from app.services.seed import seed_demo
from app.services.webhook_service import WebhookDispatcher
from app.services.worker import BackgroundWorker


def create_app(settings: Settings | None = None, *, clock: Clock | None = None) -> FastAPI:
    settings = settings or get_settings()
    clock = clock or Clock()
    configure_logging(settings.log_level)

    engine = create_db_engine(settings)
    session_factory = create_session_factory(engine)
    secret_box = SecretBox(settings.secret_key)
    dispatcher = WebhookDispatcher(session_factory, settings, secret_box, clock)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.seed_demo:
            seed_demo(session_factory, settings, clock)
        worker = None
        if settings.worker_enabled:
            worker = BackgroundWorker(
                session_factory, dispatcher, clock, settings.worker_interval_seconds
            )
            worker.start()
        try:
            yield
        finally:
            if worker is not None:
                worker.stop()
            dispatcher.close()
            engine.dispose()

    app = FastAPI(
        title="RealHuman API",
        version="0.1.0",
        description="Human verification infrastructure: sessions, signals, decisions, tokens.",
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )
    app.state.settings = settings
    app.state.clock = clock
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.state.rate_limiter = RateLimiter()
    app.state.pseudonymize = Pseudonymizer(settings.secret_key)
    app.state.secret_box = secret_box
    app.state.network = NetworkClassifier(settings.blocklist_cidrs, settings.datacenter_cidrs)
    app.state.dispatcher = dispatcher

    register_error_handlers(app)
    for module in (
        health,
        auth,
        sessions,
        verify,
        dashboard,
        api_keys,
        webhooks,
        project_settings,
        contact,
    ):
        app.include_router(module.router)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        return {"name": "RealHuman API", "docs": "/docs" if settings.docs_enabled else ""}

    # Added last = outermost: CORS headers wrap every response, including errors.
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CorsMiddleware,
        trusted_origins=settings.cors_origins,
        public_any_origin=settings.widget_cors_any_origin,
    )
    return app


def __getattr__(name: str):
    # `uvicorn app.main:app` builds the app on first access, so importing this
    # module (e.g. in tests) doesn't read the environment or open connections.
    if name == "app":
        instance = create_app()
        globals()["app"] = instance
        return instance
    raise AttributeError(name)
