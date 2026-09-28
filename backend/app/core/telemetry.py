"""OpenTelemetry tracing and error-reporting hooks.

Tracing is always *instrumented* (spans are created around requests, model
calls, tool calls and job execution) but only *exported* when an OTLP
endpoint is configured, so local development pays almost nothing.
"""

from __future__ import annotations

import contextlib
import logging
from collections.abc import Iterator
from typing import Any, Protocol

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.core.config import Settings
from app.core.logging import trace_id_var

logger = logging.getLogger(__name__)
_configured = False


def configure_tracing(settings: Settings) -> None:
    global _configured
    if _configured:
        return
    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": settings.otel_service_name,
                "service.version": settings.app_version,
                "deployment.environment": settings.app_env.value,
                "cloud.region": settings.app_region,
            }
        )
    )
    if settings.otel_enabled and settings.otel_exporter_otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            provider.add_span_processor(
                BatchSpanProcessor(OTLPSpanExporter(endpoint=settings.otel_exporter_otlp_endpoint))
            )
        except ImportError:  # pragma: no cover - optional extra
            logger.warning("otel exporter not installed; install agentos-backend[otlp]")
    trace.set_tracer_provider(provider)
    _configured = True


def get_tracer(name: str = "agentos") -> trace.Tracer:
    return trace.get_tracer(name)


@contextlib.contextmanager
def span(name: str, **attributes: Any) -> Iterator[trace.Span]:
    tracer = get_tracer()
    with tracer.start_as_current_span(name) as current:
        for key, value in attributes.items():
            if value is not None:
                current.set_attribute(key, str(value) if not isinstance(value, int | float | bool) else value)
        ctx = current.get_span_context()
        token = trace_id_var.set(format(ctx.trace_id, "032x")) if ctx.is_valid else None
        try:
            yield current
        except Exception as exc:
            current.record_exception(exc)
            current.set_status(trace.Status(trace.StatusCode.ERROR, type(exc).__name__))
            raise
        finally:
            if token is not None:
                trace_id_var.reset(token)


class ErrorReporter(Protocol):
    def capture(self, exc: BaseException, **context: Any) -> None: ...


class LoggingErrorReporter:
    """Default error tracker: structured log records (shipped by the log pipeline)."""

    def capture(self, exc: BaseException, **context: Any) -> None:
        logger.error("unhandled_exception", exc_info=exc, extra={"error_context": context})


class SentryErrorReporter:  # pragma: no cover - optional integration
    def __init__(self, dsn: str, environment: str, release: str) -> None:
        import sentry_sdk

        sentry_sdk.init(dsn=dsn, environment=environment, release=release, send_default_pii=False)
        self._sdk = sentry_sdk

    def capture(self, exc: BaseException, **context: Any) -> None:
        with self._sdk.push_scope() as scope:
            for key, value in context.items():
                scope.set_extra(key, value)
            self._sdk.capture_exception(exc)


_reporter: ErrorReporter = LoggingErrorReporter()


def configure_error_reporting(settings: Settings) -> None:
    global _reporter
    dsn = settings.sentry_dsn.get_secret_value()
    if dsn:
        try:
            _reporter = SentryErrorReporter(dsn, settings.app_env.value, settings.app_version)
        except ImportError:
            logger.warning("sentry_sdk not installed; falling back to log-based error reporting")


def get_error_reporter() -> ErrorReporter:
    return _reporter
