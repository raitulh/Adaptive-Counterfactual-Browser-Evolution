"""Normalisation of external/tool output before it is persisted or shown to a model.

External content is *data*: we bound its size and depth, strip active markup
and control characters, and never let it carry structure that could be
confused with system instructions.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser
from typing import Any

_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_WS = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n{3,}")
# Sequences an attacker could use to impersonate our prompt boundaries. The tail is bounded
# and excludes '<' so the pattern stays linear on adversarial input (no catastrophic scans).
_BOUNDARY_SPOOF = re.compile(
    r"</?\s{0,10}(?:untrusted_content|system_policy|agent_policy|user_instruction|tool_result|execution_state|memory)"
    r"[^<>]{0,200}>?", re.I)
_SKIP_CONTENT_TAGS = frozenset({"script", "style", "noscript", "iframe", "object", "embed", "template", "svg"})
_BLOCK_TAGS = frozenset({"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article",
                         "header", "footer", "table", "ul", "ol", "blockquote", "pre"})
# Hard ceiling on how much raw markup is parsed at all (callers bound output separately).
MAX_MARKUP_INPUT = 4_000_000


class _TextExtractor(HTMLParser):
    """Linear-time HTML → text using the stdlib tokenizer (no backtracking regexes)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_CONTENT_TAGS:
            self._skip_depth += 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_CONTENT_TAGS and self._skip_depth:
            self._skip_depth -= 1
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def strip_markup(text: str) -> str:
    parser = _TextExtractor()
    try:
        parser.feed(text[:MAX_MARKUP_INPUT])
        parser.close()
    except Exception:  # malformed markup: fall back to escaping-free text
        return html.unescape(text[:MAX_MARKUP_INPUT].replace("<", " <"))
    return "".join(parser.parts)


def clean_text(text: str, *, max_chars: int = 20_000, strip_html: bool = False) -> str:
    # Pre-truncate: we never return more than max_chars, so bound the work done on huge inputs.
    original_length = len(text)
    text = text[: max(max_chars * 4, 1024)]
    if strip_html:
        text = strip_markup(text)
    text = _CONTROL_CHARS.sub("", text)
    text = _BOUNDARY_SPOOF.sub("[removed-boundary-tag]", text)
    text = _WS.sub(" ", text)
    text = _BLANK_LINES.sub("\n\n", text).strip()
    if len(text) > max_chars:
        text = text[:max_chars] + f"… [truncated {max(len(text), original_length) - max_chars} chars]"
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
