"""Enumerations published in the OpenAPI document for API clients.

Some lifecycle values travel in fields that are deliberately typed as plain strings (event
types, file/automation/MCP states, notification kinds), because their payloads are open-ended
or stored as free text. Clients still need the canonical value sets, so every enumeration here
is added to ``components.schemas`` — generated clients (e.g. the web frontend's
``openapi-typescript`` types) get exact unions and fail to compile when the backend changes them.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from app.automations.models import RunStatus
from app.common.enums import ActorType, ApprovalStatus, ErrorClass, TrustLevel, VerificationStatus
from app.common.events import EventType
from app.files.models import ExtractionStatus, FileStatus
from app.integrations.models import ConnectionStatus
from app.mcp.models import MCPServerStatus, MCPToolStatus
from app.memory.models import MemoryStatus
from app.notifications.service import NotificationEvent
from app.recovery.service import RecoveryAction
from app.tasks.state import StepStatus, TaskStatus

CONTRACT_ENUMS: dict[str, Any] = {
    "TaskStatus": TaskStatus,
    "StepStatus": StepStatus,
    "EventType": EventType,
    "VerificationStatus": VerificationStatus,
    "ApprovalStatus": ApprovalStatus,
    "ConnectionStatus": ConnectionStatus,
    "NotificationEvent": NotificationEvent,
    "ErrorClass": ErrorClass,
    "ActorType": ActorType,
    "TrustLevel": TrustLevel,
    "RecoveryAction": RecoveryAction,
    "AutomationRunStatus": RunStatus,
    "FileStatus": FileStatus,
    "ExtractionStatus": ExtractionStatus,
    "MCPServerStatus": MCPServerStatus,
    "MCPToolStatus": MCPToolStatus,
    "MemoryStatus": MemoryStatus,
}


def enum_values(source: Any) -> list[str]:
    """Values of a StrEnum or of a plain constants class (UPPER_CASE string attributes)."""
    if isinstance(source, type) and issubclass(source, Enum):
        return [str(member.value) for member in source]
    return [value for name, value in vars(source).items() if name.isupper() and isinstance(value, str)]


def contract_enum_schemas() -> dict[str, dict[str, Any]]:
    return {name: {"title": name, "type": "string", "enum": enum_values(source),
                   "description": f"Canonical {name} values (published for API clients)."}
            for name, source in CONTRACT_ENUMS.items()}


def add_contract_enums(schema: dict[str, Any]) -> dict[str, Any]:
    components = schema.setdefault("components", {}).setdefault("schemas", {})
    for name, enum_schema in contract_enum_schemas().items():
        existing = components.get(name)
        if existing is not None and sorted(existing.get("enum", [])) != sorted(enum_schema["enum"]):
            raise RuntimeError(f"OpenAPI schema {name} disagrees with the published enumeration")
        components.setdefault(name, enum_schema)
    return schema
