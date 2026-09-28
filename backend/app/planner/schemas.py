"""Structured plan produced by the model (untrusted until validated)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import RiskLevel


class PlanRetryPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    max_attempts: int = Field(default=3, ge=1, le=5)


class PlanStep(BaseModel):
    model_config = ConfigDict(extra="ignore")

    step_id: str = Field(pattern=r"^[a-z][a-z0-9_]{0,40}$")
    action: str = Field(min_length=1, max_length=300, description="Short human-readable description")
    tool: str = Field(min_length=3, max_length=128)
    tool_version: str | None = Field(default=None, max_length=20)
    arguments: dict[str, Any] = Field(default_factory=dict)
    dependencies: list[str] = Field(default_factory=list, max_length=20)
    risk_level: RiskLevel = RiskLevel.LOW
    requires_approval: bool = False
    expected_result: str | None = Field(default=None, max_length=500)
    verification_method: str | None = Field(default=None, max_length=40)
    timeout_seconds: int | None = Field(default=None, ge=5, le=900)
    retry_policy: PlanRetryPolicy | None = None


class Plan(BaseModel):
    model_config = ConfigDict(extra="ignore")

    goal: str = Field(min_length=1, max_length=4000)
    summary: str = Field(default="", max_length=1000, description="User-facing one-paragraph plan summary")
    steps: list[PlanStep] = Field(default_factory=list, max_length=50)
    needs_user_input: list[str] = Field(default_factory=list, max_length=5)
    direct_response: str | None = Field(default=None, max_length=8000)


class PlanIssue(BaseModel):
    code: str
    message: str
    step_id: str | None = None
    repairable: bool = True
