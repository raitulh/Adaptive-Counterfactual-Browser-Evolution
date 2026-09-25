"""One JSON object per log line. Request/response payloads are never logged."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime

_STANDARD = set(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        entry |= {k: v for k, v in record.__dict__.items() if k not in _STANDARD}
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, default=str)


def configure_logging(level: str) -> None:
    root = logging.getLogger("realhuman")
    if getattr(root, "_configured", False):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    root.propagate = False
    root._configured = True  # type: ignore[attr-defined]
