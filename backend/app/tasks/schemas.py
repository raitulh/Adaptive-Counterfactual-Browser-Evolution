from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class TaskCreate(BaseModel):
    goal: str = Field(min_length=1, max_length=4000, description="Natural-language goal")
    agent_id: uuid.UUID | None = Field(default=None, description="Agent to use (default: built-in agent)")
    context: str | None = Field(default=None, max_length=8000, description="Optional extra context from the user")
    priority: int = Field(default=100, ge=0, le=1000, description="Lower runs sooner")
    max_duration_seconds: int | None = Field(default=None, ge=30, le=7 * 24 * 3600)

    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "goal": "Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with "
                "Rahim, and send him a confirmation email."}]})


class TaskOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    task_id: uuid.UUID = Field(validation_alias="id")
    status: str
    progress: float
    goal: str
    agent_id: uuid.UUID | None
    agent_version_id: uuid.UUID | None
    priority: int
    plan_version: int
    pending_questions: list[str] | None
    failure_code: str | None
    failure_message: str | None
    result_summary: dict[str, Any] | None
    tool_calls: int
    model_calls: int
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    completed_at: datetime | None


class StepOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_key: str
    plan_version: int
    position: int
    action: str
    tool_name: str
    tool_version: str
    status: str
    permission_level: str
    risk_level: str
    requires_approval: bool
    policy_reasons: list[str]
    approval_request_id: uuid.UUID | None
    verification_method: str
    verification_status: str
    attempt_count: int
    output_summary: str | None
    output_trust: str | None
    external_ref: str | None
    error_class: str | None
    error_message: str | None
    started_at: datetime | None
    completed_at: datetime | None


class VerificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    step_id: uuid.UUID | None
    scope: str
    status: str
    method: str
    expected: dict[str, Any]
    observed: dict[str, Any]
    differences: list[dict[str, Any]]
    evidence: dict[str, Any]
    verified_at: datetime


class TaskDetail(TaskOut):
    plan: dict[str, Any] | None = None
    steps: list[StepOut] = Field(default_factory=list)
    verifications: list[VerificationOut] = Field(default_factory=list)
    reproducibility: dict[str, Any] = Field(default_factory=dict)


class TaskEventOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    event_type: str
    step_id: uuid.UUID | None
    actor_type: str
    payload: dict[str, Any]
    created_at: datetime


class TaskEventsPage(BaseModel):
    items: list[TaskEventOut]
    next_after_seq: int | None


class TaskInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    answer: str = Field(min_length=1, max_length=4000)


class StepConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: Literal["succeeded", "did_not_happen"]
    note: str | None = Field(default=None, max_length=1000)


class ExecutionLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    step_id: uuid.UUID | None
    level: str
    message: str
    created_at: datetime
