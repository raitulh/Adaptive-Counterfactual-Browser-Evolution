"""Structured JSON logging with correlation context and secret redaction.

Correlation identifiers (request_id, trace_id, tenant_id, user_id, task_id,
step_id) live in ``contextvars`` so they flow through ``await`` boundaries and
are stamped onto every record automatically. A redaction filter scrubs
secret-looking values and keys before anything is emitted.
"""

from __future__ import annotations

import contextlib
import json
import logging
import sys
import traceback
from collections.abc import Iterator
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

from app.common.redaction import redact, redact_text

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)
trace_id_var: ContextVar[str | None] = ContextVar("trace_id", default=None)
tenant_id_var: ContextVar[str | None] = ContextVar("tenant_id", default=None)
user_id_var: ContextVar[str | None] = ContextVar("user_id", default=None)
task_id_var: ContextVar[str | None] = ContextVar("task_id", default=None)
step_id_var: ContextVar[str | None] = ContextVar("step_id", default=None)

_CONTEXT_VARS: dict[str, ContextVar[str | None]] = {
    "request_id": request_id_var,
    "trace_id": trace_id_var,
    "tenant_id": tenant_id_var,
    "user_id": user_id_var,
    "task_id": task_id_var,
    "step_id": step_id_var,
}

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}


def current_context() -> dict[str, str]:
    return {name: value for name, var in _CONTEXT_VARS.items() if (value := var.get()) is not None}


@contextlib.contextmanager
def log_context(**values: Any) -> Iterator[None]:
    """Temporarily bind correlation identifiers (e.g. task_id) to the current context."""
    tokens = []
    for name, value in values.items():
        var = _CONTEXT_VARS.get(name)
        if var is not None and value is not None:
            tokens.append((var, var.set(str(value))))
    try:
        yield
    finally:
        for var, token in reversed(tokens):
            var.reset(token)


class RedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = redact_text(record.msg)
        if record.args:
            if isinstance(record.args, dict):
                record.args = redact(record.args)
            else:
                record.args = tuple(redact_text(a) if isinstance(a, str) else a for a in record.args)
        for key, value in list(record.__dict__.items()):
            if key not in _RESERVED and not key.startswith("_"):
                record.__dict__[key] = redact({key: value})[key]
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(current_context())
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_") and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exc_type"] = record.exc_info[0].__name__ if record.exc_info[0] else None
            payload["exc"] = redact_text("".join(traceback.format_exception(*record.exc_info))[-8000:])
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        ctx = " ".join(f"{k}={v}" for k, v in current_context().items())
        base = super().format(record)
        return f"{base} {ctx}".rstrip()


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RedactionFilter())
    if json_logs:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(ConsoleFormatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Third-party loggers that are noisy or may echo request bodies.
    for noisy in ("httpx", "httpcore", "asyncio", "botocore", "urllib3", "sqlalchemy.engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
