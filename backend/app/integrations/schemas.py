from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

CAPABILITIES = ("gmail.read", "gmail.compose", "gmail.send", "calendar.read", "calendar.write", "drive.read",
                "drive.file", "contacts.read")


class ConnectGoogleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    capabilities: list[str] = Field(default_factory=lambda: ["calendar.read", "calendar.write", "gmail.send",
                                                             "contacts.read"],
                                    description=f"Least-privilege capability bundles: {', '.join(CAPABILITIES)}")
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
