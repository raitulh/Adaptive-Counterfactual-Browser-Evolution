from __future__ import annotations

import pytest

from app.execution.references import (
    UnresolvableReference,
    collect_refs,
    ref_paths_valid_for_schema,
    resolve,
    strip_refs_for_static_check,
)
from app.tools.builtin.google_calendar import FindSlotsOut

OUT = {"slots": {"slots": [{"start": "2026-09-29T15:00:00+06:00", "end": "2026-09-29T15:30:00+06:00"}]},
       "who": {"best": {"email": "rahim@example.org"}}}


def test_resolve_whole_values_and_templates() -> None:
    args = {"start": {"$ref": "steps.slots.output.slots.0.start"},
            "to": [{"$ref": "steps.who.output.best.email"}],
            "body": "Confirmed for {{steps.slots.output.slots.0.start}}."}
    resolved = resolve(args, OUT)
    assert resolved == {"start": "2026-09-29T15:00:00+06:00", "to": ["rahim@example.org"],
                        "body": "Confirmed for 2026-09-29T15:00:00+06:00."}
    assert collect_refs(args) == {"slots", "who"}


@pytest.mark.parametrize("expr", ["steps.slots.output.slots.5.start", "steps.missing.output.x",
                                  "steps.slots.output.nope", "steps.slots.output.slots.x"])
def test_unresolvable_references_raise(expr: str) -> None:
    with pytest.raises(UnresolvableReference):
        resolve({"a": {"$ref": expr}}, OUT)


def test_templates_refuse_structures_and_malformed_refs() -> None:
    with pytest.raises(UnresolvableReference):
        resolve({"a": "{{steps.slots.output.slots}}"}, OUT)
    with pytest.raises(UnresolvableReference):
        collect_refs({"a": {"$ref": "../../etc/passwd"}})


def test_static_split_and_schema_paths() -> None:
    literal, deferred = strip_refs_for_static_check({"date": "tomorrow", "start": {"$ref": "steps.s.output.x"}})
    assert literal == {"date": "tomorrow"} and deferred == {"start"}
    schemas = {"s": FindSlotsOut.model_json_schema()}
    assert ref_paths_valid_for_schema({"x": {"$ref": "steps.s.output.slots.0.start"}}, schemas) == []
    assert ref_paths_valid_for_schema({"x": {"$ref": "steps.s.output.slots.0.begin"}}, schemas)
    assert ref_paths_valid_for_schema({"x": {"$ref": "steps.s.output.slots.first"}}, schemas)
