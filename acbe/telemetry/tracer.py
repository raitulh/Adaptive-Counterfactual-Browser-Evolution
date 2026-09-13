from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List

from acbe.core.types import now_ts

_SENSITIVE_KEY_PATTERN = re.compile(
    r"(password|secret|api[_-]?key|token|cookie|authorization|credential|session[_-]?id)",
    re.IGNORECASE,
)
_REDACTED = "***REDACTED***"


def redact_secrets(value: Any) -> Any:
    """Recursively redacts anything that looks like a credential.

    Never logs secrets, credentials, cookies, API keys, or other sensitive
    user information (Section 26). Applied to every trace event before it
    is written anywhere.
    """
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if _SENSITIVE_KEY_PATTERN.search(str(k)):
                out[k] = _REDACTED
            else:
                out[k] = redact_secrets(v)
        return out
    if isinstance(value, (list, tuple)):
        return [redact_secrets(v) for v in value]
    return value


class Tracer:
    """Collects structured trace events for a single run and can export
    them as JSON (Section 26)."""

    def __init__(self, trace_dir: str = ".acbe/traces"):
        self.trace_dir = trace_dir
        self._events: List[Dict[str, Any]] = []

    def event(self, task_id: str, agent_version: str, strategy_version: str, **fields: Any) -> None:
        entry = {
            "task_id": task_id,
            "agent_version": agent_version,
            "strategy_version": strategy_version,
            "timestamp": now_ts(),
            **fields,
        }
        self._events.append(redact_secrets(entry))

    def events(self) -> List[Dict[str, Any]]:
        return list(self._events)

    def export_json(self, path: str) -> str:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self._events, fh, indent=2, default=str)
        return path

    def clear(self) -> None:
        self._events.clear()
