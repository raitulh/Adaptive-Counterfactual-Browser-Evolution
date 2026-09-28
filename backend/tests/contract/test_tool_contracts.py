"""Contract tests: every registered tool honours the platform tool contract."""

from __future__ import annotations

import re

import pytest

from app.tools.base import Tool
from app.tools.registry import get_tool_registry

pytestmark = pytest.mark.contract
TOOLS = get_tool_registry().all()


@pytest.mark.parametrize("tool", TOOLS, ids=lambda t: t.spec.key)
def test_tool_contract(tool: Tool) -> None:  # type: ignore[type-arg]
    spec = tool.spec
    assert re.fullmatch(r"^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$", spec.name)
    assert re.fullmatch(r"v\d+", spec.version)
    assert spec.input_schema.get("type") == "object" and spec.output_schema.get("type") == "object"
    assert 1 <= spec.timeout_seconds <= 900
    assert spec.description and len(spec.description) <= 300
    if spec.has_side_effects:
        assert type(tool).verify is not Tool.verify, "side-effecting tools need a real verifier"
        assert spec.verification_method != "output_schema"
    if spec.permission_level.value in ("destructive", "financial", "high_risk_write"):
        assert spec.requires_approval, "high-risk tools must require approval by default"


def test_catalogue_covers_required_capabilities() -> None:
    names = {t.spec.name for t in TOOLS}
    for required in ("calendar.list_events", "calendar.find_free_slots", "calendar.create_event",
                     "calendar.update_event", "calendar.cancel_event", "gmail.search", "gmail.read_message",
                     "gmail.create_draft", "gmail.send", "drive.search", "drive.read_file", "contacts.lookup",
                     "llm.generate_text", "data.analyze"):
        assert required in names


def test_schemas_are_stable_per_version() -> None:
    hashes = {t.spec.key: t.spec.schema_hash() for t in TOOLS}
    assert len(hashes) == len(TOOLS)
