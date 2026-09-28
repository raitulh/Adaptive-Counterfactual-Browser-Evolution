from __future__ import annotations

import pytest

from app.browser.actions import (
    DEFAULT_LOCATOR_ORDER,
    REDACTED,
    ActionValidationError,
    Click,
    Extract,
    Navigate,
    Target,
    WaitFor,
    dump_actions,
    has_side_effects,
    parse_actions,
    redact_actions,
    resolve_locator_order,
)


def test_discriminated_union_parses_every_action() -> None:
    actions = parse_actions([
        {"type": "navigate", "url": "https://example.com/a"},
        {"type": "click", "target": {"role": "button", "name": "Go"}},
        {"type": "fill", "target": {"label": "Email"}, "value": "a@b.c"},
        {"type": "wait_for", "text": "Done", "timeout_ms": 500},
        {"type": "extract", "mode": "aria"},
        {"type": "screenshot", "full_page": True},
        {"type": "press", "key": "Enter"},
        {"type": "select_option", "target": {"css": "select#c"}, "value": "blue"},
    ], max_actions=10)
    assert [a.type for a in actions] == ["navigate", "click", "fill", "wait_for", "extract", "screenshot", "press",
                                         "select_option"]
    assert isinstance(actions[0], Navigate)
    assert isinstance(actions[4], Extract)
    assert actions[4].max_chars == 8_000


@pytest.mark.parametrize("raw", [
    {"type": "navigate", "url": "https://example.com", "extra": 1},  # extra=forbid
    {"type": "evaluate", "script": "alert(1)"},  # no arbitrary JS
    {"type": "navigate", "url": "file:///etc/passwd"},
    {"type": "navigate", "url": "javascript:alert(1)"},
    {"type": "navigate", "url": "chrome://settings"},
    {"type": "navigate", "url": "https://user:pw@example.com/"},
    {"type": "press", "key": "Control+A"},  # key allowlist
    {"type": "click", "target": {}},  # at least one strategy
    {"type": "click", "target": {"name": "Go"}},  # name requires role
    {"type": "click", "target": {"role": "not-a-role"}},
    {"type": "click", "target": {"css": "xpath=//a"}},  # selector engines are not CSS
    {"type": "click", "target": {"css": "div >> text=Go"}},
    {"type": "click", "target": {"css": "internal:role=button"}},
    {"type": "wait_for", "timeout_ms": 500},  # needs exactly one condition
    {"type": "wait_for", "text": "a", "url_contains": "b"},
    {"type": "wait_for", "text": "a", "timeout_ms": 600_000},
    {"type": "extract", "mode": "html"},
    {"type": "extract", "max_chars": 10_000_000},
])
def test_invalid_actions_are_rejected(raw: dict[str, object]) -> None:
    with pytest.raises(ActionValidationError):
        parse_actions([raw], max_actions=5)


def test_css_selectors_with_attribute_equals_are_allowed() -> None:
    target = Target(css='a[href="/x?y=1"]')
    assert target.css == 'a[href="/x?y=1"]'
    assert Target(css="input:checked").css == "input:checked"


def test_action_budget_is_enforced() -> None:
    raw = [{"type": "navigate", "url": "https://example.com"}] + [{"type": "press", "key": "Tab"}] * 5
    with pytest.raises(ActionValidationError, match="too many"):
        parse_actions(raw, max_actions=5)
    with pytest.raises(ActionValidationError, match="at least one"):
        parse_actions([], max_actions=5)


def test_side_effect_detection_and_redaction() -> None:
    reads = parse_actions([{"type": "navigate", "url": "https://example.com"}, {"type": "extract"},
                           {"type": "wait_for", "url_contains": "x"}], max_actions=5)
    assert not has_side_effects(reads)
    writes = parse_actions([{"type": "navigate", "url": "https://example.com"},
                            {"type": "fill", "target": {"label": "Password"}, "value": "hunter2"},
                            {"type": "select_option", "target": {"label": "Plan"}, "value": "gold"}], max_actions=5)
    assert has_side_effects(writes)
    dumped = dump_actions(writes)
    assert has_side_effects(dumped)
    redacted = redact_actions(dumped)
    assert redacted[1]["value"] == REDACTED and redacted[2]["value"] == REDACTED
    assert dumped[1]["value"] == "hunter2"  # input not mutated
    assert "hunter2" not in str(redacted)


def test_locator_order_resolution() -> None:
    assert resolve_locator_order(None) == DEFAULT_LOCATOR_ORDER
    assert resolve_locator_order([]) == DEFAULT_LOCATOR_ORDER
    assert resolve_locator_order(["css", "bogus", "css", "text"]) == ("css", "text", "role", "label", "test_id")


def test_target_description_is_bounded_and_clean() -> None:
    target = Target(role="button", name="Pay\x00 now" + "x" * 250, css="#pay")
    text = target.describe()
    assert "\x00" not in text and len(text) <= 230
    assert WaitFor(target=Target(text="Hello")).timeout_ms == 10_000
    assert Click(target=Target(test_id="buy")).type == "click"
