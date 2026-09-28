from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.common.time import is_valid_timezone


def check_password_strength(v: str) -> str:
    classes = sum([any(c.islower() for c in v), any(c.isupper() for c in v), any(c.isdigit() for c in v),
                   any(not c.isalnum() for c in v)])
    if classes < 3:
        raise ValueError("password must mix at least three of: lowercase, uppercase, digits, symbols")
    return v


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=10, max_length=256)
    display_name: str | None = Field(default=None, max_length=200)
    organization_name: str | None = Field(default=None, max_length=200)
    timezone: str = "UTC"

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        if not is_valid_timezone(v):
            raise ValueError("unknown IANA timezone")
        return v

    @field_validator("password")
    @classmethod
    def _strength(cls, v: str) -> str:
        return check_password_strength(v)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    mfa_code: str | None = Field(default=None, max_length=10)
    device_name: str | None = Field(default=None, max_length=200)
    token_delivery: Literal["body", "cookie"] = "body"


class RefreshRequest(BaseModel):
    refresh_token: str | None = Field(default=None, max_length=200)
    token_delivery: Literal["body", "cookie"] = "body"


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    refresh_token: str | None = Field(default=None, description="Omitted when delivered as an HttpOnly cookie")
    session_id: uuid.UUID
    tenant_id: uuid.UUID
    user_id: uuid.UUID


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_name: str | None
    user_agent: str | None
    ip_address: str | None
    auth_method: str
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    current: bool = False


class SwitchOrganizationRequest(BaseModel):
    organization_id: uuid.UUID


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=10, max_length=256)

    @field_validator("new_password")
    @classmethod
    def _strength(cls, v: str) -> str:
        return check_password_strength(v)


class MfaEnrollResponse(BaseModel):
    factor_id: uuid.UUID
    secret: str
    otpauth_uri: str


class MfaCodeRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class OAuthStartResponse(BaseModel):
    authorization_url: str
    state: str


class StreamTokenResponse(BaseModel):
    token: str
    expires_in: int
