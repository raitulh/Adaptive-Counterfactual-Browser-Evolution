from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.common.time import is_valid_timezone


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    email_verified: bool
    display_name: str | None
    timezone: str
    locale: str
    status: str
    mfa_enabled: bool
    is_platform_admin: bool
    created_at: datetime
    last_login_at: datetime | None


class MeOut(UserOut):
    tenant_id: uuid.UUID
    role: str
    permissions: list[str]


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=200)
    timezone: str | None = None
    locale: str | None = Field(default=None, pattern=r"^[a-z]{2}(-[A-Z]{2})?$")

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str | None) -> str | None:
        if v is not None and not is_valid_timezone(v):
            raise ValueError("unknown IANA timezone")
        return v


class AccountDeletionRequest(BaseModel):
    password: str | None = Field(default=None, max_length=256, description="Required for password accounts")
    confirm: bool = Field(description="Must be true")
