from __future__ import annotations

from typing import Literal

from pydantic import Field, model_serializer

from app.schemas.common import CamelModel, UtcDatetime

RiskLevel = Literal["low", "medium", "high"]
SignalId = Literal[
    "interaction_pattern", "challenge_response", "session_consistency", "request_behavior"
]
SignalStatus = Literal["pending", "pass", "review", "fail"]
ChallengeType = Literal["press_hold", "single_step"]
SessionStatus = Literal["created", "challenged", "analyzing", "completed", "expired"]
Decision = Literal["allow", "step_up", "deny"]
InputMethod = Literal["pointer", "touch", "keyboard", "assistive"]


class CreateSessionIn(CamelModel):
    site_key: str | None = Field(default=None, min_length=1, max_length=64)
    action: str | None = Field(default=None, max_length=64)


class ChallengeInfo(CamelModel):
    type: ChallengeType
    ttl_seconds: int


class VerificationSessionOut(CamelModel):
    id: str
    status: SessionStatus
    challenge: ChallengeInfo
    created_at: UtcDatetime
    expires_at: UtcDatetime


class ChallengeTelemetry(CamelModel):
    """
    Aggregate interaction features computed in the browser. No raw coordinates,
    keystrokes or identifiers — only counts, durations and ratios.
    """

    version: int = Field(default=1, ge=1, le=100)
    pointer_type: Literal["mouse", "pen", "touch"] | None = None
    approach_moves: int | None = Field(default=None, ge=0, le=100_000)
    approach_path_px: float | None = Field(default=None, ge=0, le=1_000_000)
    approach_straightness: float | None = Field(default=None, ge=0, le=1)
    approach_speed_cv: float | None = Field(default=None, ge=0, le=1_000)
    hold_moves: int | None = Field(default=None, ge=0, le=100_000)
    hold_jitter_px: float | None = Field(default=None, ge=0, le=100_000)
    time_to_first_input_ms: int | None = Field(default=None, ge=0, le=86_400_000)
    key_repeats: int | None = Field(default=None, ge=0, le=100_000)
    untrusted_events: int | None = Field(default=None, ge=0, le=100_000)
    visibility_changes: int | None = Field(default=None, ge=0, le=100_000)
    early_releases: int | None = Field(default=None, ge=0, le=100_000)
    webdriver: bool | None = None
    max_touch_points: int | None = Field(default=None, ge=0, le=1_000)
    page_dwell_ms: int | None = Field(default=None, ge=0, le=31 * 86_400_000)


class ChallengeResponseIn(CamelModel):
    type: ChallengeType
    input_method: InputMethod
    hold_duration_ms: int = Field(ge=0, le=3_600_000)
    telemetry: ChallengeTelemetry | None = None


class SignalOut(CamelModel):
    id: SignalId
    label: str
    status: SignalStatus
    score: float = Field(ge=0, le=1)
    weight: float = Field(ge=0, le=1)
    detail: str | None = None

    @model_serializer(mode="wrap")
    def _omit_empty_detail(self, handler):  # zod: `detail: z.string().optional()` rejects null
        data = handler(self)
        if data.get("detail") is None:
            data.pop("detail", None)
        return data


class VerificationResultOut(CamelModel):
    session_id: str
    verified: bool
    decision: Decision
    risk: RiskLevel
    score: float = Field(ge=0, le=1)
    token: str | None
    signals: list[SignalOut]
    decided_at: UtcDatetime


class VerifyIn(CamelModel):
    token: str = Field(min_length=1, max_length=256)


class VerifyOut(CamelModel):
    session: str
    verified: bool
    decision: Decision
    risk: RiskLevel
    score: float
    action: str | None
    origin: str
    signals: list[SignalOut]
    decided_at: UtcDatetime
    redeemed_at: UtcDatetime
