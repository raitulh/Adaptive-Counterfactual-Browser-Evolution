"""Universal tool interface.

A tool is *code the backend owns*. The model may only *request* a tool by name
with JSON arguments; the ToolExecutor decides whether it runs. Each tool
declares its risk, permission level, scopes, idempotency behaviour, timeout,
retry policy and how its effect is verified and reconciled.
"""

from __future__ import annotations

import abc
import hashlib
import json
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, ClassVar, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

from app.common.context import RequestContext
from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.verification.types import VerificationMethod, VerificationOutcome

if TYPE_CHECKING:
    from app.organizations.schemas import OrganizationPolicy
    from app.tools.services import ToolServices


class RetryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_attempts: int = Field(default=3, ge=1, le=10)
    base_delay_seconds: float = Field(default=2.0, ge=0.1, le=300)
    max_delay_seconds: float = Field(default=60.0, ge=0.1, le=3600)
    jitter: float = Field(default=0.3, ge=0, le=1)


class AuditPolicy(BaseModel):
    log_arguments: bool = True
    redact_fields: list[str] = Field(default_factory=list)


class IdempotencyStrategy:
    NATIVE_KEY = "native_key"  # provider accepts our key (e.g. client-assigned Calendar event id)
    RECONCILE_LOOKUP = "reconcile_lookup"  # we can look up whether the effect happened (e.g. Message-ID search)
    NONE = "none"  # read-only / naturally idempotent


class ToolSpec(BaseModel):
    name: str
    version: str = "v1"
    description: str
    category: str
    provider: str = "internal"
    permission_level: PermissionLevel = PermissionLevel.READ
    risk_level: RiskLevel = RiskLevel.LOW
    required_scopes: list[str] = Field(default_factory=list)
    requires_approval: bool = False
    supports_idempotency: bool = True
    idempotency_strategy: str = IdempotencyStrategy.NONE
    timeout_seconds: float = 30.0
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    parallel_safe: bool = True
    feature_flag: str | None = None
    tenant_restrictions: dict[str, Any] = Field(default_factory=dict)
    audit_policy: AuditPolicy = Field(default_factory=AuditPolicy)
    verification_method: str = VerificationMethod.OUTPUT_SCHEMA
    output_trust: TrustLevel = TrustLevel.CONTROLLED_AGENT_OUTPUT
    async_execution: bool = False  # executed out-of-band by a dedicated worker (browser)
    # Provider lookups used by ``reconcile`` may lag the write (search indexes). An empty lookup is
    # only trusted this long after the attempt started; before that the check is repeated later.
    reconcile_settle_seconds: int = Field(default=0, ge=0, le=3600)
    input_schema: dict[str, Any] = Field(default_factory=dict)
    output_schema: dict[str, Any] = Field(default_factory=dict)

    @property
    def key(self) -> str:
        return f"{self.name}:{self.version}"

    @property
    def has_side_effects(self) -> bool:
        return self.permission_level.has_side_effects

    def schema_hash(self) -> str:
        blob = json.dumps({"in": self.input_schema, "out": self.output_schema}, sort_keys=True)
        return hashlib.sha256(blob.encode()).hexdigest()


@dataclass(slots=True)
class ToolContext:
    ctx: RequestContext
    task_id: uuid.UUID
    step_id: uuid.UUID
    step_key: str
    attempt_number: int
    idempotency_key: str
    services: ToolServices
    org_policy: OrganizationPolicy
    timezone: str = "UTC"
    strategy: dict[str, Any] = field(default_factory=dict)

    @property
    def tenant_id(self) -> uuid.UUID:
        return self.ctx.tenant_id

    @property
    def user_id(self) -> uuid.UUID:
        return self.ctx.user_id


class ToolResult(BaseModel):
    output: dict[str, Any]
    summary: str
    external_ref: str | None = None
    trust: TrustLevel = TrustLevel.CONTROLLED_AGENT_OUTPUT
    # For async tools: the out-of-band job has been dispatched; output arrives later.
    pending_external: bool = False
    usage: dict[str, float] = Field(default_factory=dict)


class ReconcileStatus:
    FOUND = "found"  # the effect happened; result reconstructed
    NOT_FOUND = "not_found"  # conclusively did not happen; safe to retry
    UNKNOWN = "unknown"  # cannot tell; must not retry automatically


class ReconcileOutcome(BaseModel):
    status: str
    result: ToolResult | None = None
    evidence: dict[str, Any] = Field(default_factory=dict)


class RiskAssessment(BaseModel):
    permission_level: PermissionLevel
    risk_level: RiskLevel
    requires_approval: bool
    reasons: list[str] = Field(default_factory=list)


InT = TypeVar("InT", bound=BaseModel)
OutT = TypeVar("OutT", bound=BaseModel)


class Tool(abc.ABC, Generic[InT, OutT]):
    spec: ClassVar[ToolSpec]
    input_model: ClassVar[type[BaseModel]]
    output_model: ClassVar[type[BaseModel]]

    def __init_subclass__(cls, **kwargs: Any) -> None:
        super().__init_subclass__(**kwargs)
        # Concrete tools declare spec/input_model/output_model; stamp the JSON schemas onto the spec.
        if "spec" in cls.__dict__ and hasattr(cls, "input_model") and hasattr(cls, "output_model"):
            cls.spec = cls.spec.model_copy(update={
                "input_schema": cls.input_model.model_json_schema(),
                "output_schema": cls.output_model.model_json_schema(),
            })

    @property
    def name(self) -> str:
        return self.spec.name

    @abc.abstractmethod
    async def execute(self, tctx: ToolContext, args: InT) -> ToolResult: ...

    async def verify(self, tctx: ToolContext, args: InT, result: ToolResult) -> VerificationOutcome:
        """Default: the output must satisfy the declared output schema (for read tools)."""
        try:
            self.output_model.model_validate(result.output)
        except Exception as exc:
            from app.verification.types import Difference

            return VerificationOutcome.failed_with(
                VerificationMethod.OUTPUT_SCHEMA, [Difference(field="output", expected="schema-valid",
                                                              observed=type(exc).__name__)])
        return VerificationOutcome.passed_with(VerificationMethod.OUTPUT_SCHEMA,
                                               evidence={"schema": self.output_model.__name__})

    async def reconcile(self, tctx: ToolContext, args: InT) -> ReconcileOutcome:
        """Determine whether a previous attempt with unknown outcome took effect."""
        if not self.spec.has_side_effects:
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND, evidence={"reason": "read-only tool"})
        return ReconcileOutcome(status=ReconcileStatus.UNKNOWN, evidence={"reason": "no reconciliation strategy"})

    def assess(self, args: InT, policy: OrganizationPolicy) -> RiskAssessment:
        """Argument-dependent risk. May only *escalate* over the static spec."""
        return RiskAssessment(permission_level=self.spec.permission_level, risk_level=self.spec.risk_level,
                              requires_approval=self.spec.requires_approval)

    def describe(self, args: InT) -> str:
        return f"{self.spec.description} ({self.spec.name})"

    def output_from_user_input(self, args: InT, answer: str, details: dict[str, Any]) -> ToolResult | None:
        """When this tool paused to ask the user for a value (``NeedsUserInput``), build the
        step's output from the user's answer so execution continues without re-planning.
        Return None to fall back to re-planning with the answer as context."""
        return None

    def target(self, args: InT) -> str | None:
        return None

    def parse_args(self, raw: dict[str, Any]) -> InT:
        return self.input_model.model_validate(raw)  # type: ignore[return-value]


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
