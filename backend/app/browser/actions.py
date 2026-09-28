"""Typed browser actions.

The model (or a tool) can only request actions from this closed, strictly validated
vocabulary. There is no "evaluate JavaScript", no file upload, no arbitrary selector
engine: targets are located with accessible roles, labels, visible text, test ids or
plain CSS, in a configurable order, and an ambiguous target is an error — the executor
never guesses which element was meant.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, field_validator, model_validator

from app.common.sanitize import clean_text

LocatorStrategy = Literal["role", "label", "text", "test_id", "css"]
DEFAULT_LOCATOR_ORDER: tuple[LocatorStrategy, ...] = ("role", "label", "text", "test_id", "css")
SIDE_EFFECT_ACTIONS = frozenset({"click", "fill", "press", "select_option"})
REDACTED = "[redacted]"

MAX_URL_LENGTH = 2048
MAX_WAIT_MS = 60_000
MAX_EXTRACT_CHARS = 20_000

# WAI-ARIA roles accepted by Playwright's get_by_role.
ARIA_ROLES = frozenset({
    "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption", "cell",
    "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo", "definition", "deletion",
    "dialog", "directory", "document", "emphasis", "feed", "figure", "form", "generic", "grid", "gridcell",
    "group", "heading", "img", "insertion", "link", "list", "listbox", "listitem", "log", "main", "marquee",
    "math", "meter", "menu", "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "navigation", "none",
    "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row",
    "rowgroup", "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton", "status",
    "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel", "term", "textbox",
    "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
})

AllowedKey = Literal[
    "Enter", "Tab", "Escape", "Backspace", "Delete", "Space", "Home", "End", "PageUp", "PageDown",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
]

# Selector-engine prefixes (xpath=, text=, internal:..., id=...) and chaining are not plain CSS.
_ENGINE_PREFIX = re.compile(r"^\s*[a-zA-Z_][\w-]*(?::[\w-]+)?\s*=")
_Text = Annotated[str, Field(min_length=1, max_length=300)]


class Target(BaseModel):
    """How to find one element. At least one strategy is required; several may be given as
    alternatives (tried in locator order). ``name`` refines ``role``."""

    model_config = ConfigDict(extra="forbid")

    role: str | None = Field(default=None, max_length=40)
    name: _Text | None = None
    label: _Text | None = None
    text: _Text | None = None
    test_id: _Text | None = None
    css: _Text | None = None
    exact: bool = False

    @field_validator("role")
    @classmethod
    def _role(cls, value: str | None) -> str | None:
        if value is None:
            return None
        role = value.strip().lower()
        if role not in ARIA_ROLES:
            raise ValueError(f"unknown ARIA role '{value[:40]}'")
        return role

    @field_validator("css")
    @classmethod
    def _css(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if ">>" in value or _ENGINE_PREFIX.match(value) or "\x00" in value:
            raise ValueError("css must be a plain CSS selector (no selector engines or '>>' chaining)")
        return value.strip()

    @model_validator(mode="after")
    def _at_least_one(self) -> Target:
        if not any(self.has(s) for s in DEFAULT_LOCATOR_ORDER):
            raise ValueError("target needs at least one of role, label, text, test_id, css")
        if self.name is not None and self.role is None:
            raise ValueError("'name' is only valid together with 'role'")
        return self

    def has(self, strategy: str) -> bool:
        return getattr(self, strategy, None) is not None

    def describe(self) -> str:
        parts = []
        if self.role:
            parts.append(f"role={self.role}" + (f" name={self.name!r}" if self.name else ""))
        for key in ("label", "text", "test_id", "css"):
            value = getattr(self, key)
            if value:
                parts.append(f"{key}={value!r}")
        return clean_text(", ".join(parts), max_chars=200)


class _Action(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Navigate(_Action):
    type: Literal["navigate"] = "navigate"
    url: str = Field(min_length=8, max_length=MAX_URL_LENGTH)

    @field_validator("url")
    @classmethod
    def _http_only(cls, value: str) -> str:
        value = value.strip()
        parts = urlsplit(value)
        if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
            raise ValueError("only absolute http(s) URLs can be opened")
        if parts.username or parts.password:
            raise ValueError("credentials in URLs are not allowed")
        return value


class Click(_Action):
    type: Literal["click"] = "click"
    target: Target


class Fill(_Action):
    type: Literal["fill"] = "fill"
    target: Target
    value: str = Field(max_length=5000)


class WaitFor(_Action):
    type: Literal["wait_for"] = "wait_for"
    target: Target | None = None
    url_contains: str | None = Field(default=None, min_length=1, max_length=500)
    text: str | None = Field(default=None, min_length=1, max_length=300)
    timeout_ms: int = Field(default=10_000, ge=100, le=MAX_WAIT_MS)

    @model_validator(mode="after")
    def _exactly_one(self) -> WaitFor:
        given = [x for x in (self.target, self.url_contains, self.text) if x is not None]
        if len(given) != 1:
            raise ValueError("wait_for needs exactly one of target, url_contains, text")
        return self


class Extract(_Action):
    type: Literal["extract"] = "extract"
    target: Target | None = None
    mode: Literal["text", "aria", "html_outline"] = "text"
    max_chars: int = Field(default=8_000, ge=100, le=MAX_EXTRACT_CHARS)


class Screenshot(_Action):
    type: Literal["screenshot"] = "screenshot"
    full_page: bool = False


class Press(_Action):
    type: Literal["press"] = "press"
    key: AllowedKey
    target: Target | None = None


class SelectOption(_Action):
    type: Literal["select_option"] = "select_option"
    target: Target
    value: str = Field(min_length=1, max_length=500)


BrowserAction = Annotated[
    Navigate | Click | Fill | WaitFor | Extract | Screenshot | Press | SelectOption,
    Field(discriminator="type"),
]
_ACTIONS = TypeAdapter(list[BrowserAction])


class ActionValidationError(ValueError):
    pass


def parse_actions(raw: Any, *, max_actions: int) -> list[BrowserAction]:
    """Validate a JSON action list (from a tool call or the database)."""
    try:
        actions = _ACTIONS.validate_python(raw)
    except ValueError as exc:
        raise ActionValidationError(f"invalid browser actions: {str(exc)[:500]}") from exc
    check_action_count(actions, max_actions=max_actions)
    return actions


def check_action_count(actions: list[BrowserAction], *, max_actions: int) -> None:
    if not actions:
        raise ActionValidationError("at least one browser action is required")
    if len(actions) > max_actions:
        raise ActionValidationError(f"too many browser actions ({len(actions)} > {max_actions})")


def dump_actions(actions: list[BrowserAction]) -> list[dict[str, Any]]:
    return [a.model_dump(mode="json", exclude_none=True) for a in actions]


def has_side_effects(actions: list[BrowserAction] | list[dict[str, Any]]) -> bool:
    return any(_type_of(a) in SIDE_EFFECT_ACTIONS for a in actions)


def navigation_urls(actions: list[BrowserAction]) -> list[str]:
    return [a.url for a in actions if isinstance(a, Navigate)]


def redact_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop values typed into pages (may be personal data) once they are no longer needed."""
    out: list[dict[str, Any]] = []
    for action in actions:
        item = dict(action)
        if item.get("type") in ("fill", "select_option") and "value" in item:
            item["value"] = REDACTED
        out.append(item)
    return out


def resolve_locator_order(configured: Any) -> tuple[LocatorStrategy, ...]:
    """Configured order first (unknown entries ignored), then the remaining defaults."""
    order: list[LocatorStrategy] = []
    if isinstance(configured, list | tuple):
        for item in configured:
            if item in DEFAULT_LOCATOR_ORDER and item not in order:
                order.append(item)
    order.extend(s for s in DEFAULT_LOCATOR_ORDER if s not in order)
    return tuple(order)


def _type_of(action: Any) -> str | None:
    if isinstance(action, dict):
        value = action.get("type")
        return value if isinstance(value, str) else None
    return getattr(action, "type", None)
