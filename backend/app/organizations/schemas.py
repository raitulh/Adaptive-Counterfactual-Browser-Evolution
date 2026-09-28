from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.common.enums import SystemRole


class OrganizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    plan: str
    status: str
    is_personal: bool
    data_region: str
    created_at: datetime
    role: str | None = None


class OrganizationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class OrganizationUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)


class MemberOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    email: str
    display_name: str | None
    role: str
    status: str
    created_at: datetime


class MemberAdd(BaseModel):
    email: EmailStr
    role: SystemRole = SystemRole.MEMBER


class MemberRoleUpdate(BaseModel):
    role: SystemRole


class OrganizationPolicy(BaseModel):
    """Tenant-level execution policy. Stored in organizations.policy and versioned."""

    model_config = ConfigDict(extra="forbid")

    # Tools that are never allowed for this organization (glob patterns, e.g. "browser.*").
    blocked_tools: list[str] = Field(default_factory=list)
    # Tools that always require approval regardless of default risk policy.
    always_require_approval: list[str] = Field(default_factory=list)
    # Whether DESTRUCTIVE / FINANCIAL tools may run at all (with approval).
    allow_destructive_actions: bool = False
    allow_financial_actions: bool = False
    # E-mail domains considered internal (sending outside escalates risk).
    internal_email_domains: list[str] = Field(default_factory=list)
    # Browser egress policy additions.
    browser_allowed_domains: list[str] = Field(default_factory=list)
    browser_denied_domains: list[str] = Field(default_factory=list)
    approval_ttl_seconds: int | None = Field(default=None, ge=60, le=7 * 24 * 3600)
    max_concurrent_tasks: int | None = Field(default=None, ge=1, le=1000)
    extra: dict[str, Any] = Field(default_factory=dict)


class PolicyOut(BaseModel):
    policy: OrganizationPolicy
    policy_version: int
