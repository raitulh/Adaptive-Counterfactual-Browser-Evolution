from __future__ import annotations

from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field, field_validator, model_validator

from app.schemas.common import CamelModel, UtcDatetime
from app.schemas.verification import RiskLevel

EventOutcome = Literal["verified", "step_up", "blocked", "expired"]
ApiKeyEnvironment = Literal["test", "live"]
WebhookEventType = Literal[
    "verification.completed", "verification.step_up", "verification.blocked", "session.expired"
]
RetentionDays = Literal["1", "7", "30"]


class ActivityPoint(CamelModel):
    date: UtcDatetime
    verified: int
    suspicious: int
    blocked: int


class Metric(CamelModel):
    value: int
    delta: float


class OverviewMetrics(CamelModel):
    volume: Metric
    verified: Metric
    suspicious: Metric
    blocked: Metric


class OverviewOut(CamelModel):
    range_days: int
    sample: bool
    metrics: OverviewMetrics
    activity: list[ActivityPoint]


class VerificationEventOut(CamelModel):
    id: str
    session_id: str
    outcome: EventOutcome
    risk: RiskLevel
    score: float
    origin: str
    action: str
    at: UtcDatetime


class SessionRecordOut(CamelModel):
    id: str
    outcome: EventOutcome
    risk: RiskLevel
    score: float
    challenge: Literal["none", "press_hold", "single_step"]
    origin: str
    started_at: UtcDatetime
    duration_ms: int


class RequestLogOut(CamelModel):
    id: str
    method: Literal["GET", "POST", "DELETE"]
    path: str
    status: int
    latency_ms: int
    at: UtcDatetime


# ── API keys ────────────────────────────────────────────────────────────────


def _key_name(value: str) -> str:
    value = value.strip()
    if not 2 <= len(value) <= 48:
        raise ValueError("Use 2 to 48 characters.")
    if not all(ch.isascii() and (ch.isalnum() or ch in "_ .-") for ch in value):
        raise ValueError("Use letters, numbers, spaces, dots, dashes or underscores.")
    return value


class CreateApiKeyIn(CamelModel):
    name: Annotated[str, AfterValidator(_key_name)]
    environment: ApiKeyEnvironment


class ApiKeyOut(CamelModel):
    id: str
    name: str
    environment: ApiKeyEnvironment
    masked_key: str
    created_at: UtcDatetime
    last_used_at: UtcDatetime | None


class CreatedApiKeyOut(ApiKeyOut):
    secret: str


# ── Webhooks ────────────────────────────────────────────────────────────────


def _https_url(value: str) -> str:
    value = value.strip()
    if len(value) > 2048:
        raise ValueError("The URL is too long.")
    parts = urlsplit(value)
    if parts.scheme != "https" or not parts.hostname:
        raise ValueError("Use an https:// URL.")
    if parts.username or parts.password:
        raise ValueError("Don't include credentials in the URL.")
    return value


class CreateWebhookIn(CamelModel):
    url: Annotated[str, AfterValidator(_https_url)]
    events: list[WebhookEventType] = Field(min_length=1, max_length=4)

    @field_validator("events")
    @classmethod
    def _unique(cls, value: list[str]) -> list[str]:
        return list(dict.fromkeys(value))


class WebhookEndpointOut(CamelModel):
    id: str
    url: str
    events: list[WebhookEventType]
    status: Literal["active", "disabled"]
    created_at: UtcDatetime


class CreatedWebhookEndpointOut(WebhookEndpointOut):
    # Shown once. Used to verify the `RealHuman-Signature` header.
    signing_secret: str


# ── Project settings ────────────────────────────────────────────────────────


class ProjectSettingsOut(CamelModel):
    project_name: str
    site_key: str
    allow_threshold: float
    step_up_threshold: float
    retention_days: RetentionDays


class ProjectSettingsIn(CamelModel):
    project_name: str = Field(min_length=2, max_length=60)
    allow_threshold: float = Field(ge=0.5, le=0.99)
    step_up_threshold: float = Field(ge=0.1, le=0.95)
    retention_days: RetentionDays

    @field_validator("project_name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @model_validator(mode="after")
    def _ordered(self) -> ProjectSettingsIn:
        if self.step_up_threshold >= self.allow_threshold:
            raise ValueError("Step-up threshold must be lower than the allow threshold.")
        return self
