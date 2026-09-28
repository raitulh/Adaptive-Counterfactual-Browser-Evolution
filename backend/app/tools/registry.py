"""ToolRegistry / ToolResolver.

Built-in tools are registered from code (the code is the source of truth for
their behaviour; ``tool_definitions``/``tool_versions`` rows mirror them for
reproducibility and admin UIs). Tenant-registered MCP tools are resolved per
tenant from the database through the MCP gateway, and are only visible to the
tenant that registered and approved them.
"""

from __future__ import annotations

import fnmatch
import importlib
import logging
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.time import utcnow
from app.core.exceptions import ToolNotFound
from app.tools.base import Tool, ToolSpec

logger = logging.getLogger(__name__)

BUILTIN_TOOL_MODULES = (
    "app.tools.builtin.google_calendar",
    "app.tools.builtin.gmail",
    "app.tools.builtin.drive",
    "app.tools.builtin.contacts",
    "app.tools.builtin.compute",
    "app.memory.tools",
    "app.files.tools",
    "app.search.tools",
    "app.browser.tools",
)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, dict[str, Tool[Any, Any]]] = {}

    def register(self, tool: Tool[Any, Any]) -> None:
        spec = tool.spec
        versions = self._tools.setdefault(spec.name, {})
        if spec.version in versions:
            raise ValueError(f"duplicate tool registration {spec.key}")
        if not spec.input_schema or not spec.output_schema:
            raise ValueError(f"tool {spec.key} has no schemas")
        if spec.has_side_effects and type(tool).verify is Tool.verify:
            raise ValueError(f"side-effecting tool {spec.key} must implement a real verifier")
        versions[spec.version] = tool

    def get(self, name: str, version: str | None = None) -> Tool[Any, Any]:
        versions = self._tools.get(name)
        if not versions:
            raise ToolNotFound(f"Unknown tool '{name}'", details={"tool": name})
        if version is None:
            return versions[sorted(versions)[-1]]
        tool = versions.get(version)
        if tool is None:
            raise ToolNotFound(f"Unknown version '{version}' of tool '{name}'",
                               details={"tool": name, "version": version})
        return tool

    def has(self, name: str) -> bool:
        return name in self._tools

    def all(self) -> list[Tool[Any, Any]]:
        return [t for versions in self._tools.values() for t in versions.values()]

    def specs(self) -> list[ToolSpec]:
        return [t.spec for t in self.all()]


def load_builtin_tools(registry: ToolRegistry) -> ToolRegistry:
    for module_name in BUILTIN_TOOL_MODULES:
        module = importlib.import_module(module_name)
        for tool in getattr(module, "TOOLS", []):
            registry.register(tool)
    return registry


_registry: ToolRegistry | None = None


def get_tool_registry() -> ToolRegistry:
    global _registry
    if _registry is None:
        _registry = load_builtin_tools(ToolRegistry())
        logger.info("tool registry loaded", extra={"tools": len(_registry.all())})
    return _registry


def matches_any(name: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(name, p) for p in patterns)


class ToolResolver:
    """Resolves a tool for a tenant: built-ins first, then that tenant's approved MCP tools."""

    def __init__(self, registry: ToolRegistry | None = None) -> None:
        self.registry = registry or get_tool_registry()

    async def resolve(self, session: AsyncSession, tenant_id: uuid.UUID, name: str, version: str | None = None
                      ) -> Tool[Any, Any]:
        if self.registry.has(name):
            return self.registry.get(name, version)
        if name.startswith("mcp."):
            from app.mcp.service import resolve_mcp_tool

            tool = await resolve_mcp_tool(session, tenant_id, name)
            if tool is not None:
                return tool
        raise ToolNotFound(f"Unknown tool '{name}'", details={"tool": name})

    async def available(self, session: AsyncSession, tenant_id: uuid.UUID) -> list[Tool[Any, Any]]:
        tools = list(self.registry.all())
        from app.mcp.service import list_mcp_tools_for_tenant

        tools.extend(await list_mcp_tools_for_tenant(session, tenant_id))
        return tools


async def sync_tool_catalog(session: AsyncSession, registry: ToolRegistry | None = None) -> int:
    """Mirror built-in tool specs into tool_definitions/tool_versions (idempotent)."""
    from app.tools.models import ToolDefinition, ToolVersion

    registry = registry or get_tool_registry()
    changed = 0
    for tool in registry.all():
        spec = tool.spec
        definition = (await session.execute(select(ToolDefinition).where(ToolDefinition.name == spec.name))
                      ).scalar_one_or_none()
        if definition is None:
            definition = ToolDefinition(name=spec.name, category=spec.category, provider=spec.provider,
                                        description=spec.description, is_builtin=True)
            session.add(definition)
            await session.flush()
        definition.description = spec.description
        existing = (await session.execute(select(ToolVersion).where(
            ToolVersion.tool_definition_id == definition.id, ToolVersion.version == spec.version))).scalar_one_or_none()
        if existing is None:
            session.add(ToolVersion(
                tool_definition_id=definition.id, version=spec.version, input_schema=spec.input_schema,
                output_schema=spec.output_schema, permission_level=spec.permission_level.value,
                risk_level=spec.risk_level.value, required_scopes=spec.required_scopes,
                requires_approval=spec.requires_approval, supports_idempotency=spec.supports_idempotency,
                timeout_seconds=spec.timeout_seconds, retry_policy=spec.retry_policy.model_dump(),
                audit_policy=spec.audit_policy.model_dump(), schema_hash=spec.schema_hash(), created_at=utcnow()))
            changed += 1
        elif existing.schema_hash != spec.schema_hash():
            # A tool's contract must not change silently under the same version.
            raise RuntimeError(f"tool {spec.key} schema changed without a version bump")
    await session.commit()
    return changed
