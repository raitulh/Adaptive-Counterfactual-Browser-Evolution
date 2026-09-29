"""The OpenAPI document carries the canonical lifecycle enumerations API clients are generated from."""

from __future__ import annotations

from typing import get_args

from app.api.contract import CONTRACT_ENUMS, enum_values
from app.common.events import EventType
from app.integrations.models import ConnectionStatus
from app.integrations.schemas import ConnectionState
from app.main import create_app
from app.tasks.state import StepStatus, TaskStatus


def test_openapi_publishes_lifecycle_enums() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    for name, source in CONTRACT_ENUMS.items():
        assert sorted(schemas[name]["enum"]) == sorted(enum_values(source)), name
    assert set(schemas["TaskStatus"]["enum"]) == {s.value for s in TaskStatus}
    assert set(schemas["EventType"]["enum"]) == {e.value for e in EventType}
    # Response models reference the enums instead of plain strings.
    assert schemas["TaskOut"]["properties"]["status"] == {"$ref": "#/components/schemas/TaskStatus"}
    assert schemas["StepOut"]["properties"]["status"] == {"$ref": "#/components/schemas/StepStatus"}
    assert set(schemas["StepStatus"]["enum"]) == {s.value for s in StepStatus}
    assert "tasks:create" in schemas["PermissionCode"]["enum"]


def test_connection_state_literal_matches_constants() -> None:
    assert set(get_args(ConnectionState)) == set(enum_values(ConnectionStatus))


def test_google_capabilities_are_published_and_match_the_scope_map() -> None:
    from app.integrations.google.oauth import CAPABILITY_SCOPES
    from app.integrations.schemas import GoogleCapability

    assert {c.value for c in GoogleCapability} == set(CAPABILITY_SCOPES)
    schemas = create_app().openapi()["components"]["schemas"]
    assert set(schemas["GoogleCapability"]["enum"]) == set(CAPABILITY_SCOPES)
    items = schemas["ConnectGoogleRequest"]["properties"]["capabilities"]["items"]
    assert items == {"$ref": "#/components/schemas/GoogleCapability"}


def test_agent_versions_and_tools_expose_author_and_execution_settings() -> None:
    schemas = create_app().openapi()["components"]["schemas"]
    assert {"created_by", "created_by_name"} <= set(schemas["AgentVersionOut"]["properties"])
    assert {"idempotency_strategy", "timeout_seconds", "max_attempts", "parallel_safe"} <= set(
        schemas["ToolOut"]["properties"])
