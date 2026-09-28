from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ModelPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    default: str | None = Field(default=None, max_length=100)
    fast: str | None = Field(default=None, max_length=100)
    reasoning: str | None = Field(default=None, max_length=100)
    fallbacks: list[str] = Field(default_factory=list, max_length=5)
    planning_tier: str = Field(default="default", pattern="^(fast|default|reasoning)$")


class ToolPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed: list[str] = Field(default_factory=lambda: ["*"], max_length=200)
    denied: list[str] = Field(default_factory=list, max_length=200)


class MemoryPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = True
    max_items: int = Field(default=8, ge=0, le=50)
    extract_after_task: bool = True


class ExecutionLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_steps: int | None = Field(default=None, ge=1, le=100)
    max_tool_calls: int | None = Field(default=None, ge=1, le=1000)
    max_model_calls: int | None = Field(default=None, ge=1, le=500)
    max_duration_seconds: int | None = Field(default=None, ge=10, le=7 * 24 * 3600)
    max_cost_usd: float | None = Field(default=None, ge=0, le=1000)
    max_browser_actions: int | None = Field(default=None, ge=0, le=1000)


class VerificationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Reads can be verified by schema; writes always need a real verifier (not configurable off).
    readback_attempts: int = Field(default=3, ge=1, le=10)
    readback_delay_ms: int = Field(default=500, ge=0, le=30_000)


class AgentVersionIn(BaseModel):
    instructions: str = Field(default="", max_length=20_000)
    model_policy: ModelPolicy = Field(default_factory=ModelPolicy)
    tool_policy: ToolPolicy = Field(default_factory=ToolPolicy)
    memory_policy: MemoryPolicy = Field(default_factory=MemoryPolicy)
    execution_limits: ExecutionLimits = Field(default_factory=ExecutionLimits)
    verification_policy: VerificationPolicy = Field(default_factory=VerificationPolicy)


class AgentCreate(AgentVersionIn):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class AgentVersionOut(AgentVersionIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    agent_id: uuid.UUID
    version_number: int
    checksum: str
    created_at: datetime


class AgentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    description: str | None
    status: str
    current_version_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    current_version: AgentVersionOut | None = None


class AgentUpdate(BaseModel):
    description: str | None = Field(default=None, max_length=2000)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class ResolvedAgent(BaseModel):
    """Effective configuration used for one task (a DB version or the built-in default)."""

    agent_id: uuid.UUID | None
    agent_version_id: uuid.UUID | None
    label: str
    instructions: str
    model_policy: ModelPolicy
    tool_policy: ToolPolicy
    memory_policy: MemoryPolicy
    execution_limits: ExecutionLimits
    verification_policy: VerificationPolicy

    def as_metadata(self) -> dict[str, Any]:
        return {"agent_id": str(self.agent_id) if self.agent_id else None,
                "agent_version_id": str(self.agent_version_id) if self.agent_version_id else None,
                "label": self.label}
