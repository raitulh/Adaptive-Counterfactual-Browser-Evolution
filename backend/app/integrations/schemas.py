from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class GoogleCapability(StrEnum):
    """Least-privilege Google Workspace capability bundles (each maps to exact OAuth scopes)."""

    GMAIL_READ = "gmail.read"
    GMAIL_COMPOSE = "gmail.compose"
    GMAIL_SEND = "gmail.send"
    CALENDAR_READ = "calendar.read"
    CALENDAR_WRITE = "calendar.write"
    DRIVE_READ = "drive.read"
    DRIVE_FILE = "drive.file"
    CONTACTS_READ = "contacts.read"


CAPABILITIES = tuple(c.value for c in GoogleCapability)


class ConnectGoogleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capabilities: list[GoogleCapability] = Field(
        default_factory=lambda: [GoogleCapability.CALENDAR_READ, GoogleCapability.CALENDAR_WRITE,
                                 GoogleCapability.GMAIL_SEND, GoogleCapability.CONTACTS_READ],
        description="Least-privilege capability bundles")
    login_hint: str | None = Field(default=None, max_length=320)


class ConnectGoogleResponse(BaseModel):
    authorization_url: str
    requested_scopes: list[str]


ConnectionState = Literal["connected", "expired", "revoked", "insufficient_scope", "temporarily_unavailable",
                          "disconnected"]


class ConnectionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    provider: str
    account_email: str | None
    status: ConnectionState
    scopes: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)
    token_expires_at: datetime | None
    last_refreshed_at: datetime | None
    last_error_code: str | None
    connected_at: datetime
    disconnected_at: datetime | None
