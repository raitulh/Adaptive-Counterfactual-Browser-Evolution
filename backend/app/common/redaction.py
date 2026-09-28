"""Secret and sensitive-data redaction for logs, audit records and errors."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

REDACTED = "[REDACTED]"

_SENSITIVE_KEY = re.compile(
    r"(pass(word|wd)?|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key|"
    r"refresh[_-]?token|access[_-]?key|client[_-]?secret|otp|mfa[_-]?secret|signature)",
    re.IGNORECASE,
)
_SENSITIVE_VALUE_PATTERNS = [
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}"),  # JWT
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"AIza[0-9A-Za-z_-]{30,}"),  # Google API key
    re.compile(r"ya29\.[0-9A-Za-z_-]{20,}"),  # Google OAuth access token
    re.compile(r"1//[0-9A-Za-z_-]{20,}"),  # Google refresh token
    re.compile(r"sk-[A-Za-z0-9]{20,}"),
    re.compile(r"gAAAAA[A-Za-z0-9_=-]{20,}"),  # Fernet ciphertext
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----"),
]


def redact_text(value: str) -> str:
    for pattern in _SENSITIVE_VALUE_PATTERNS:
        value = pattern.sub(REDACTED, value)
    return value


# Keys that contain a sensitive-looking word but only carry counters/metadata.
_SAFE_KEYS = frozenset(
    {
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "max_output_tokens",
        "token_count",
        "tokens",
        "token_type",
        "token_expires_at",
        "input_token_estimate",
        "output_token_estimate",
    }
)


def is_sensitive_key(key: str) -> bool:
    lowered = key.lower()
    if lowered in _SAFE_KEYS:
        return False
    return bool(_SENSITIVE_KEY.search(lowered))


def redact(value: Any, *, max_depth: int = 8) -> Any:
    """Recursively redact secrets from mappings/sequences/strings."""
    if max_depth <= 0:
        return "[TRUNCATED]"
    if isinstance(value, Mapping):
        out: dict[str, Any] = {}
        for key, item in value.items():
            skey = str(key)
            out[skey] = REDACTED if is_sensitive_key(skey) else redact(item, max_depth=max_depth - 1)
        return out
    if isinstance(value, list | tuple | set):
        return [redact(item, max_depth=max_depth - 1) for item in value]
    if isinstance(value, str):
        return redact_text(value)
    return value
