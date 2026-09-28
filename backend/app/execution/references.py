"""Deterministic data flow between steps.

Plans pass data only through explicit references:

* ``{"$ref": "steps.<step>.output.<path>"}`` — replaced by the referenced value;
* ``"... {{steps.<step>.output.<path>}} ..."`` — string interpolation.

Paths use dots with numeric list indexes (``slots.0.start``). Resolution is a
pure function of completed step outputs, so retries resolve identically.
"""

from __future__ import annotations

import re
from typing import Any

from app.core.exceptions import ToolInputInvalid

REF_PATTERN = re.compile(r"^steps\.([a-z][a-z0-9_]{0,40})\.output(?:\.([A-Za-z0-9_.\-]+))?$")
TEMPLATE_PATTERN = re.compile(r"\{\{\s*(steps\.[a-z][a-z0-9_]{0,40}\.output(?:\.[A-Za-z0-9_.\-]+)?)\s*\}\}")
MAX_DEPTH = 12


class UnresolvableReference(ToolInputInvalid):
    code = "unresolvable_reference"
    message = "A step argument references data that is not available."


def is_ref(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"$ref"} and isinstance(value["$ref"], str)


def parse_ref(expr: str) -> tuple[str, list[str]]:
    match = REF_PATTERN.match(expr.strip())
    if not match:
        raise UnresolvableReference(f"Malformed reference '{expr[:100]}'", details={"ref": expr[:100]})
    path = [p for p in (match.group(2) or "").split(".") if p]
    return match.group(1), path


def collect_refs(value: Any, _depth: int = 0) -> set[str]:
    """All step ids referenced anywhere inside an argument structure."""
    if _depth > MAX_DEPTH:
        return set()
    found: set[str] = set()
    if is_ref(value):
        found.add(parse_ref(value["$ref"])[0])
    elif isinstance(value, dict):
        for item in value.values():
            found |= collect_refs(item, _depth + 1)
    elif isinstance(value, list):
        for item in value:
            found |= collect_refs(item, _depth + 1)
    elif isinstance(value, str):
        for expr in TEMPLATE_PATTERN.findall(value):
            found.add(parse_ref(expr)[0])
    return found


def contains_ref(value: Any) -> bool:
    return bool(collect_refs(value))


def _walk_path(data: Any, path: list[str], expr: str) -> Any:
    current = data
    for part in path:
        if isinstance(current, list):
            if not part.isdigit() or int(part) >= len(current):
                raise UnresolvableReference(f"Reference '{expr}' points past the end of a list",
                                            details={"ref": expr})
            current = current[int(part)]
        elif isinstance(current, dict):
            if part not in current:
                raise UnresolvableReference(f"Reference '{expr}' names a missing field '{part}'",
                                            details={"ref": expr})
            current = current[part]
        else:
            raise UnresolvableReference(f"Reference '{expr}' cannot descend into a scalar", details={"ref": expr})
    return current


def resolve(value: Any, outputs: dict[str, dict[str, Any]], _depth: int = 0) -> Any:
    if _depth > MAX_DEPTH:
        raise UnresolvableReference("Argument structure is too deep")
    if is_ref(value):
        step, path = parse_ref(value["$ref"])
        if step not in outputs:
            raise UnresolvableReference(f"Step '{step}' has no output yet", details={"ref": value["$ref"]})
        return _walk_path(outputs[step], path, value["$ref"])
    if isinstance(value, dict):
        return {k: resolve(v, outputs, _depth + 1) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v, outputs, _depth + 1) for v in value]
    if isinstance(value, str) and "{{" in value:
        def repl(match: re.Match[str]) -> str:
            step, path = parse_ref(match.group(1))
            if step not in outputs:
                raise UnresolvableReference(f"Step '{step}' has no output yet", details={"ref": match.group(1)})
            resolved = _walk_path(outputs[step], path, match.group(1))
            if isinstance(resolved, dict | list):
                raise UnresolvableReference("Templates may only interpolate scalar values",
                                            details={"ref": match.group(1)})
            return "" if resolved is None else str(resolved)

        return TEMPLATE_PATTERN.sub(repl, value)
    return value


def strip_refs_for_static_check(arguments: dict[str, Any]) -> tuple[dict[str, Any], set[str]]:
    """Split top-level arguments into literal ones (checked at plan time) and names that
    contain references (checked after resolution at execution time)."""
    literal: dict[str, Any] = {}
    deferred: set[str] = set()
    for key, value in arguments.items():
        if contains_ref(value):
            deferred.add(key)
        else:
            literal[key] = value
    return literal, deferred


def ref_paths_valid_for_schema(value: Any, output_schemas: dict[str, dict[str, Any]]) -> list[str]:
    """Best-effort static check that referenced fields exist in the producing tool's output schema."""
    problems: list[str] = []

    def check(expr: str) -> None:
        step, path = parse_ref(expr)
        schema = output_schemas.get(step)
        if schema is None:
            return
        defs = schema.get("$defs", {})
        node: Any = schema
        for part in path:
            if isinstance(node, dict) and "$ref" in node:
                node = defs.get(str(node["$ref"]).split("/")[-1], {})
            if isinstance(node, dict) and "anyOf" in node:
                node = next((n for n in node["anyOf"] if n.get("type") != "null"), node["anyOf"][0])
                if isinstance(node, dict) and "$ref" in node:
                    node = defs.get(str(node["$ref"]).split("/")[-1], {})
            if not isinstance(node, dict):
                return
            if node.get("type") == "array" or "items" in node:
                if not part.isdigit():
                    problems.append(f"{expr}: '{part}' must be a list index")
                    return
                node = node.get("items", {})
                continue
            props = node.get("properties")
            if props is None:
                return  # free-form object: cannot check statically
            if part not in props:
                problems.append(f"{expr}: output has no field '{part}'")
                return
            node = props[part]

    def walk(v: Any, depth: int = 0) -> None:
        if depth > MAX_DEPTH:
            return
        if is_ref(v):
            check(v["$ref"])
        elif isinstance(v, dict):
            for item in v.values():
                walk(item, depth + 1)
        elif isinstance(v, list):
            for item in v:
                walk(item, depth + 1)
        elif isinstance(v, str):
            for expr in TEMPLATE_PATTERN.findall(v):
                check(expr)

    walk(value)
    return problems
