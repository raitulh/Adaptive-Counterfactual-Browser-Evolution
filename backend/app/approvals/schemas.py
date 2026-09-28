from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ApprovalOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    task_id: uuid.UUID
    step_id: uuid.UUID
    user_id: uuid.UUID
    action: str
    tool_name: str
    summary: str
    target: str | None
    arguments_preview: dict[str, Any]
    risk_level: str
    permission_level: str
    reasons: list[str]
    status: str
    expires_at: datetime
    approved_by: uuid.UUID | None
    approved_at: datetime | None
    rejected_by: uuid.UUID | None
    rejected_at: datetime | None
    rejection_reason: str | None
    consumed_at: datetime | None
    created_at: datetime


class ApproveRequest(BaseModel):
    note: str | None = Field(default=None, max_length=1000)


class RejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)
