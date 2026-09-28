"""Provider-agnostic model request/response types."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.common.enums import StrEnum, TrustLevel


class ModelTier(StrEnum):
    FAST = "fast"
    DEFAULT = "default"
    REASONING = "reasoning"


class Message(BaseModel):
    role: Literal["user", "model"]
    text: str


class CallMetadata(BaseModel):
    purpose: str
    request_id: str | None = None
    tenant_id: uuid.UUID | None = None
    user_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    step_id: uuid.UUID | None = None
    agent_id: uuid.UUID | None = None


class ModelRequest(BaseModel):
    system: str
    messages: list[Message]
    tier: ModelTier = ModelTier.DEFAULT
    model: str | None = Field(default=None, description="Explicit model; otherwise chosen by tier/policy")
    temperature: float = 0.2
    max_output_tokens: int | None = None
    response_schema: dict[str, Any] | None = None
    json_mode: bool = False
    timeout_seconds: float | None = None
    metadata: CallMetadata
    # Trust level of the *least* trusted content included (for audit/telemetry).
    min_trust: TrustLevel = TrustLevel.TRUSTED_SYSTEM_LOGIC


class ModelUsage(BaseModel):
    input_tokens: int | None = None
    output_tokens: int | None = None
    total_tokens: int | None = None
    input_token_estimate: int = 0
    output_token_estimate: int = 0
    cost_usd: float = 0.0
    priced: bool = False


class ModelResponse(BaseModel):
    text: str
    model: str
    provider: str
    finish_reason: str | None = None
    usage: ModelUsage = Field(default_factory=ModelUsage)
    latency_ms: float = 0.0
    provider_request_id: str | None = None
    status: str = "ok"


def estimate_tokens(text: str) -> int:
    # ~4 characters per token is a conservative planning estimate across providers.
    return max(1, len(text) // 4)
