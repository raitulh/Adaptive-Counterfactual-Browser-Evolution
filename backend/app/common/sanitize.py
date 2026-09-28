"""Normalisation of external/tool output before it is persisted or shown to a model.

External content is *data*: we bound its size and depth, strip active markup
and control characters, and never let it carry structure that could be
confused with system instructions.
"""

from __future__ import annotations

import html
import re
from typing import Any

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SCRIPT_STYLE = re.compile(r"<(script|style|noscript|iframe|object|embed)[^>]*>.*?</\1\s*>", re.I | re.S)
_TAGS = re.compile(r"<[^>]+>")
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n{3,}")
# Sequences an attacker could use to impersonate our prompt boundaries.
_BOUNDARY_SPOOF = re.compile(r"</?\s*(untrusted_content|system_policy|agent_policy|user_instruction|tool_result)"
                             r"[^>]*>", re.I)


def strip_markup(text: str) -> str:
    text = _SCRIPT_STYLE.sub(" ", text)
    text = _TAGS.sub(" ", text)
    text = html.unescape(text)
    return text


def clean_text(text: str, *, max_chars: int = 20_000, strip_html: bool = False) -> str:
    if strip_html:
        text = strip_markup(text)
    text = _CONTROL_CHARS.sub("", text)
    text = _BOUNDARY_SPOOF.sub("[removed-boundary-tag]", text)
    text = _WS.sub(" ", text)
    text = _BLANK_LINES.sub("\n\n", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + f"… [truncated {len(text) - max_chars} chars]"
    return text


def bound_structure(
    value: Any,
    *,
    max_depth: int = 6,
    max_items: int = 50,
    max_string: int = 4_000,
    _depth: int = 0,
) -> Any:
    """Bound nesting depth, collection sizes and string lengths of JSON-like data."""
    if _depth >= max_depth:
        return "[max-depth]"
    if isinstance(value, dict):
        out: dict[str, Any] = {}
        for idx, (key, item) in enumerate(value.items()):
            if idx >= max_items:
                out["__truncated__"] = f"{len(value) - max_items} more keys"
                break
            out[str(key)[:200]] = bound_structure(
                item, max_depth=max_depth, max_items=max_items, max_string=max_string, _depth=_depth + 1
            )
        return out
    if isinstance(value, list | tuple):
        items = [
            bound_structure(item, max_depth=max_depth, max_items=max_items, max_string=max_string,
                            _depth=_depth + 1)
            for item in list(value)[:max_items]
        ]
        if len(value) > max_items:
            items.append(f"[{len(value) - max_items} more items]")
        return items
    if isinstance(value, str):
        return clean_text(value, max_chars=max_string)
    if isinstance(value, int | float | bool) or value is None:
        return value
    return clean_text(str(value), max_chars=max_string)
