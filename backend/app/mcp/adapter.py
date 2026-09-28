"""MCPToolAdapter: exposes one approved MCP tool through the universal ``Tool`` interface.

The class-level ``spec``/``input_model`` pattern of ``Tool`` is static, so the adapter
builds its ``ToolSpec`` per instance from the admin-approved ``mcp_tools`` row and
validates arguments against the tool's JSON Schema in ``parse_args``.

Trust boundaries:
* permission/risk/approval come from the admin-assigned row, never from server hints
  (hints can only *escalate* in ``assess``);
* right before each call the tool and server are re-read and re-checked (disabled
  server, rug-pulled schema or cross-tenant use are refused even for a tool resolved
  earlier), the per-server rate limit is enforced, and no DB transaction is held
  across the network call;
* output is ``UNTRUSTED_EXTERNAL_CONTENT``: text is cleaned and bounded, structured
  content is bounded, images/audio/resources are dropped with a note;
* a write is only verified ``PASSED`` on machine evidence (declared outputSchema +
  valid structuredContent); otherwise ``INCONCLUSIVE`` so the engine asks the user.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from pydantic import BaseModel, ConfigDict, Field, RootModel, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.enums import ErrorClass, PermissionLevel, RiskLevel, TrustLevel, VerificationStatus
from app.common.feature_flags import Flags
from app.common.redaction import redact_text
from app.common.sanitize import bound_structure, clean_text
from app.core.database import get_session_factory, set_tenant_scope
from app.core.exceptions import AppError, ToolError, ToolInputInvalid, ToolOutputInvalid, ToolTimeout
from app.mcp.client import MCPConnectionManager, get_mcp_connection_manager
from app.mcp.policy import DEFAULT_LIMITS, MCPLimits, MCPPolicyChecker, build_validator, schema_problems
from app.security.ratelimit import get_rate_limiter
from app.tools.base import (
    IdempotencyStrategy,
    ReconcileOutcome,
    ReconcileStatus,
    RetryPolicy,
    RiskAssessment,
    Tool,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.verification.types import Difference, VerificationMethod, VerificationOutcome

if TYPE_CHECKING:
    from app.mcp.models import MCPServer, MCPTool
    from app.organizations.schemas import OrganizationPolicy


class MCPArguments(RootModel[dict[str, Any]]):
    """Arguments for an MCP tool: the JSON object itself (already validated against the tool's
    input schema by ``MCPToolAdapter.parse_args``)."""


class MCPToolOutput(BaseModel):
    """Normalised, bounded result of ``tools/call``. ``structured`` holds the server's
    ``structuredContent`` (bounded); ``text`` the cleaned text content blocks."""

    model_config = ConfigDict(extra="forbid")

    server: str
    tool: str
    text: str = ""
    content_blocks: int = 0
    structured: dict[str, Any] | None = None
    structured_modified: bool = Field(default=False, description="Bounding changed the structured content")
    notes: list[str] = Field(default_factory=list)
    is_error: bool = False


@dataclass(frozen=True, slots=True)
class MCPToolBinding:
    """Detached snapshot of an approved tool and its server (no secrets, no ORM state)."""

    tenant_id: uuid.UUID
    server_id: uuid.UUID
    server_name: str
    tool_id: uuid.UUID
    remote_name: str
    qualified_name: str
    title: str | None
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any] | None
    annotations: dict[str, Any]
    permission_level: PermissionLevel
    risk_level: RiskLevel
    requires_approval: bool
    schema_hash: str
    timeout_seconds: float
    rate_limit_per_minute: int

    @classmethod
    def from_rows(cls, server: MCPServer, tool: MCPTool) -> MCPToolBinding:
        return cls(
            tenant_id=tool.tenant_id, server_id=server.id, server_name=server.name, tool_id=tool.id,
            remote_name=tool.remote_name, qualified_name=tool.qualified_name, title=tool.title,
            description=tool.description, input_schema=dict(tool.input_schema),
            output_schema=dict(tool.output_schema) if tool.output_schema is not None else None,
            annotations=dict(tool.annotations or {}), permission_level=PermissionLevel(tool.permission_level),
            risk_level=RiskLevel(tool.risk_level), requires_approval=tool.requires_approval,
            schema_hash=tool.schema_hash, timeout_seconds=float(server.timeout_seconds),
            rate_limit_per_minute=int(server.rate_limit_per_minute),
        )

    @property
    def read_only(self) -> bool:
        return self.permission_level is PermissionLevel.READ


def build_spec(binding: MCPToolBinding) -> ToolSpec:
    read_only = binding.read_only
    description = binding.description or binding.title or \
        f"MCP tool {binding.remote_name} on server {binding.server_name}"
    return ToolSpec(
        name=binding.qualified_name,
        version="v1",
        description=description,
        category="mcp",
        provider="mcp",
        permission_level=binding.permission_level,
        risk_level=binding.risk_level,
        requires_approval=binding.requires_approval,
        # MCP has no generic idempotency key; side-effecting calls are never retried automatically.
        supports_idempotency=read_only,
        idempotency_strategy=IdempotencyStrategy.NONE,
        timeout_seconds=binding.timeout_seconds,
        retry_policy=RetryPolicy(max_attempts=2 if read_only else 1),
        parallel_safe=read_only,
        feature_flag=Flags.MCP,
        tenant_restrictions={"tenant_id": str(binding.tenant_id)},
        verification_method=VerificationMethod.OUTPUT_SCHEMA if read_only
        else VerificationMethod.PROVIDER_CONFIRMATION,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
        input_schema=binding.input_schema,
        output_schema=binding.output_schema or {},
    )


def normalize_call_result(raw: dict[str, Any], binding: MCPToolBinding, *, limits: MCPLimits = DEFAULT_LIMITS,
                          policy: MCPPolicyChecker | None = None) -> MCPToolOutput:
    """Turn a ``CallToolResult`` into bounded, sanitised data. Never raises on ``isError``."""
    policy = policy or MCPPolicyChecker(limits=limits)
    content = raw.get("content", [])
    if content is None:
        content = []
    if not isinstance(content, list):
        raise ToolOutputInvalid("The MCP tool returned malformed content")
    notes: list[str] = []
    texts: list[str] = []
    for block in content[:limits.max_content_blocks]:
        block_type = block.get("type") if isinstance(block, dict) else None
        if block_type == "text" and isinstance(block.get("text"), str):
            texts.append(block["text"])
        elif block_type in ("image", "audio"):
            notes.append(f"{block_type} content omitted")
        elif block_type in ("resource", "resource_link"):
            notes.append("resource content omitted")
        else:
            notes.append("unsupported content block omitted")
    if len(content) > limits.max_content_blocks:
        notes.append(f"{len(content) - limits.max_content_blocks} more content block(s) omitted")
    text = clean_text("\n\n".join(texts), max_chars=limits.max_text_output_chars)

    structured: dict[str, Any] | None = None
    modified = False
    raw_structured = raw.get("structuredContent")
    if raw_structured is not None:
        if not isinstance(raw_structured, dict):
            notes.append("non-object structured content omitted")
        elif not policy.structured_output_within_limits(raw_structured):
            notes.append("structured content exceeded the size limit and was omitted")
        else:
            structured = policy.bound_structured_output(raw_structured)
            modified = structured != raw_structured
    return MCPToolOutput(server=binding.server_name, tool=binding.remote_name, text=text,
                         content_blocks=len(texts), structured=structured, structured_modified=modified,
                         notes=list(dict.fromkeys(notes))[:20], is_error=raw.get("isError") is True)


class MCPToolAdapter(Tool[MCPArguments, MCPToolOutput]):
    input_model = MCPArguments
    output_model = MCPToolOutput

    def __init__(self, binding: MCPToolBinding, *, connection_manager: MCPConnectionManager | None = None,
                 session_factory: async_sessionmaker[AsyncSession] | None = None,
                 policy: MCPPolicyChecker | None = None) -> None:
        self.binding = binding
        self.spec = build_spec(binding)  # type: ignore[misc]  # per-instance spec (see module docstring)
        self._policy = policy or MCPPolicyChecker()
        self._connection_manager = connection_manager
        self._session_factory = session_factory
        self._input_validator = build_validator(binding.input_schema)
        self._output_validator = build_validator(binding.output_schema) if binding.output_schema else None

    # ------------------------------------------------------------------ planning-time hooks
    def _validated(self, raw: Any) -> dict[str, Any]:
        """Size/depth limits, then the tool's JSON Schema (Draft 2020-12 unless it declares
        another draft); ``additionalProperties: false`` rejects unknown keys."""
        arguments = self._policy.check_arguments({} if raw is None else raw)
        problems = schema_problems(self._input_validator, arguments)
        if problems:
            raise ToolInputInvalid("Arguments do not match the MCP tool's input schema", details={
                "tool": self.binding.qualified_name,
                "errors": [{"path": p.path, "message": p.message} for p in problems],
            })
        return arguments

    def parse_args(self, raw: dict[str, Any]) -> MCPArguments:
        return MCPArguments(self._validated(raw))

    def assess(self, args: MCPArguments, policy: OrganizationPolicy) -> RiskAssessment:
        """Server hints are untrusted: they may escalate, never relax, the admin-assigned levels."""
        assessment = super().assess(args, policy)
        hints = self.binding.annotations
        if hints.get("destructiveHint") is True and hints.get("readOnlyHint") is not True:
            assessment = RiskAssessment(
                permission_level=assessment.permission_level,
                risk_level=RiskLevel.max(assessment.risk_level, RiskLevel.HIGH),
                requires_approval=True,
                reasons=[*assessment.reasons,
                         "the MCP server marks this tool as destructive (advisory hint)"])
        return assessment

    def describe(self, args: MCPArguments) -> str:
        label = self.binding.title or self.binding.remote_name
        return f"{label} (MCP tool {self.binding.remote_name} on server {self.binding.server_name})"

    def target(self, args: MCPArguments) -> str | None:
        return f"mcp:{self.binding.server_name}"

    # ------------------------------------------------------------------ execution
    def _manager(self) -> MCPConnectionManager:
        return self._connection_manager or get_mcp_connection_manager()

    async def execute(self, tctx: ToolContext, args: MCPArguments) -> ToolResult:
        from app.mcp.service import load_call_endpoint

        binding = self.binding
        self._policy.ensure_tenant(binding.tenant_id, tctx.tenant_id)
        arguments = self._validated(args.root)
        session_factory = self._session_factory or get_session_factory()
        # Re-check approval state right before the call, then release the DB before network I/O.
        async with session_factory() as session:
            set_tenant_scope(session, tctx.tenant_id)
            endpoint = await load_call_endpoint(session, tctx.tenant_id, binding.tool_id, binding.schema_hash)
        await get_rate_limiter().enforce("mcp_server", str(binding.server_id), binding.rate_limit_per_minute)

        started = time.monotonic()
        deadline = self._policy.call_timeout(binding.timeout_seconds)
        try:
            try:
                # One deadline for handshake + call: a slow initialize cannot extend the budget.
                async with asyncio.timeout(deadline):
                    raw = await self._manager().call_tool(endpoint, binding.remote_name, arguments)
            except TimeoutError as exc:
                raise ToolTimeout("The MCP tool did not respond in time",
                                  details={"timeout_seconds": deadline}) from exc
            output = normalize_call_result(raw, binding, limits=self._policy.limits, policy=self._policy)
        except AppError as exc:
            await self._audit(tctx, arguments, started, status="failure", error_code=exc.code)
            raise
        if output.is_error:
            await self._audit(tctx, arguments, started, status="failure", error_code="mcp_tool_error")
            error_class = ErrorClass.TOOL_UNAVAILABLE if binding.read_only else ErrorClass.INVALID_INPUT
            raise ToolError("The MCP tool reported an error", code="mcp_tool_error", error_class=error_class,
                            details={"tool": binding.qualified_name,
                                     "remote_error": redact_text(clean_text(output.text, max_chars=300))})
        await self._audit(tctx, arguments, started, status="success", error_code=None)
        summary = f"MCP tool {binding.qualified_name} returned {output.content_blocks} text block(s)" + (
            " and structured content" if output.structured is not None else "")
        return ToolResult(output=output.model_dump(mode="json"), summary=summary,
                          trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT)

    async def _audit(self, tctx: ToolContext, arguments: dict[str, Any], started: float, *, status: str,
                     error_code: str | None) -> None:
        binding = self.binding
        await audit.record_independent(
            category=AuditCategory.TOOL, action="mcp.tool.call", status=status, ctx=tctx.ctx,
            resource_type="mcp_tool", resource_id=binding.tool_id, task_id=tctx.task_id, step_id=tctx.step_id,
            tool_name=binding.qualified_name,
            metadata={"server_id": str(binding.server_id), "server": binding.server_name,
                      "remote_tool": binding.remote_name,
                      "duration_ms": int((time.monotonic() - started) * 1000),
                      "argument_keys": sorted(arguments)[:20], "error_code": error_code})

    # ------------------------------------------------------------------ verification
    async def verify(self, tctx: ToolContext, args: MCPArguments, result: ToolResult) -> VerificationOutcome:
        try:
            output = MCPToolOutput.model_validate(result.output)
        except ValidationError:
            return VerificationOutcome.failed_with(VerificationMethod.OUTPUT_SCHEMA, [
                Difference(field="output", expected="normalised MCP tool output", observed="malformed")])
        if self.binding.read_only:
            return self._verify_read(output)
        return self._verify_write(output)

    def _verify_read(self, output: MCPToolOutput) -> VerificationOutcome:
        method = VerificationMethod.OUTPUT_SCHEMA
        if output.is_error:
            return VerificationOutcome.failed_with(method, [Difference(field="isError", expected=False,
                                                                       observed=True)])
        if self._output_validator is None:
            return VerificationOutcome.passed_with(method, evidence={"output_schema_declared": False,
                                                                     "content_blocks": output.content_blocks})
        if output.structured is None:
            return VerificationOutcome.failed_with(method, [Difference(
                field="structuredContent", expected="present (outputSchema declared)", observed=None)])
        problems = schema_problems(self._output_validator, output.structured)
        if problems:
            return VerificationOutcome.failed_with(method, [
                Difference(field=p.path, expected="matches outputSchema", observed=p.message)
                for p in problems])
        return VerificationOutcome.passed_with(method, evidence={
            "output_schema_declared": True, "structured_keys": sorted(output.structured)[:20]})

    def _verify_write(self, output: MCPToolOutput) -> VerificationOutcome:
        method = VerificationMethod.PROVIDER_CONFIRMATION
        structured = output.structured
        reason: str | None = None
        if output.is_error:
            reason = "the tool reported an error"
        elif self._output_validator is None:
            reason = "the tool declares no outputSchema, so its effect cannot be confirmed"
        elif structured is None:
            reason = "the tool returned no structured content"
        elif schema_problems(self._output_validator, structured):
            reason = "the structured content does not match the declared outputSchema"
        if reason is not None or structured is None:
            return VerificationOutcome(status=VerificationStatus.INCONCLUSIVE, method=method,
                                       evidence={"reason": reason, "tool": self.binding.qualified_name})
        return VerificationOutcome.passed_with(
            method, observed=bound_structure(structured, max_depth=4, max_items=20, max_string=500),
            evidence={"output_schema_validated": True, "tool": self.binding.qualified_name})

    async def reconcile(self, tctx: ToolContext, args: MCPArguments) -> ReconcileOutcome:
        if self.binding.read_only:
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND,
                                    evidence={"reason": "read-only MCP tool"})
        return ReconcileOutcome(status=ReconcileStatus.UNKNOWN,
                                evidence={"reason": "MCP offers no generic idempotency or effect lookup"})
