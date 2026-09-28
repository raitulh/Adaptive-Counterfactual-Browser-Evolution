"""Automation API schemas and schedule evaluation.

Schedules are standard 5-field cron expressions evaluated against the *local wall clock*
of the automation's IANA time zone and stored as UTC instants:

* each local wall-clock time fires at most once: on a DST fall-back the repeated hour fires
  only on its first occurrence (a daily 01:30 job does not run twice);
* local times skipped by a DST spring-forward fire exactly once, at the equivalent instant
  after the jump (02:30 → 03:30 local);
* runs are at least ``MIN_INTERVAL_MINUTES`` apart.
"""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from croniter import CroniterBadDateError, CroniterError, croniter
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MIN_INTERVAL_MINUTES = 15
_MACROS = {
    "@yearly": "0 0 1 1 *", "@annually": "0 0 1 1 *", "@monthly": "0 0 1 * *", "@weekly": "0 0 * * 0",
    "@daily": "0 0 * * *", "@midnight": "0 0 * * *", "@hourly": "0 * * * *",
}
_MAX_ITERATIONS = 2000


def validate_timezone(name: str) -> str:
    """Return the IANA zone name or raise ``ValueError``."""
    candidate = (name or "").strip()
    if not candidate or candidate.startswith(("/", ".")) or ".." in candidate:
        raise ValueError("timezone must be an IANA time zone such as 'Europe/Berlin'")
    try:
        ZoneInfo(candidate)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown time zone '{candidate[:64]}'") from exc
    return candidate


def _minute_of_day_values(field: list[Any], upper: int) -> list[int]:
    return list(range(upper)) if field == ["*"] else sorted(int(v) for v in field)


def validate_cron(expression: str) -> str:
    """Normalize and validate a cron expression. Rejects non-5-field syntax, expressions
    that never fire and schedules that could fire more often than every 15 minutes."""
    expr = " ".join((expression or "").split())
    expr = _MACROS.get(expr.lower(), expr)
    if len(expr.split(" ")) != 5:
        raise ValueError("cron_expression must have exactly 5 fields: minute hour day month weekday")
    try:
        parsed = croniter(expr)
    except (CroniterError, ValueError, KeyError) as exc:
        raise ValueError("cron_expression is not a valid cron expression") from exc
    minutes = _minute_of_day_values(parsed.expanded[0], 60)
    hours = _minute_of_day_values(parsed.expanded[1], 24)
    times = sorted(h * 60 + m for h in hours for m in minutes)
    gaps = [b - a for a, b in itertools.pairwise(times)]
    gaps.append(times[0] + 24 * 60 - times[-1])  # conservatively assume consecutive days can both fire
    if min(gaps) < MIN_INTERVAL_MINUTES:
        raise ValueError(f"schedules may run at most every {MIN_INTERVAL_MINUTES} minutes")
    try:
        next_run_after(expr, "UTC", datetime(2000, 1, 1, tzinfo=UTC))
    except ValueError as exc:
        raise ValueError("cron_expression never matches a real date") from exc
    return expr


def next_run_after(expression: str, timezone: str, after: datetime) -> datetime:
    """First occurrence strictly after ``after`` (aware), evaluated on the local wall clock of
    ``timezone``; returned as an aware UTC datetime."""
    tz = ZoneInfo(timezone)
    after_utc = after.astimezone(UTC)
    local_naive = after_utc.astimezone(tz).replace(tzinfo=None)
    try:
        it = croniter(expression, local_naive)
        for _ in range(_MAX_ITERATIONS):
            candidate: datetime = it.get_next(datetime)
            # fold=0: an ambiguous time maps to its first occurrence, a skipped time to the
            # instant after the DST jump.
            instant = candidate.replace(tzinfo=tz, fold=0).astimezone(UTC)
            if instant > after_utc:
                return instant
    except CroniterBadDateError as exc:
        raise ValueError("cron_expression has no future occurrence") from exc
    raise ValueError("cron_expression has no future occurrence")


def next_run_from(expression: str, timezone: str, *, now: datetime,
                  after: datetime | None = None) -> datetime:
    """Next occurrence to schedule: after ``after`` (the slot just materialized), but never in
    the past, so a scheduler outage produces at most one catch-up run."""
    anchor = max(after, now) if after is not None else now
    return next_run_after(expression, timezone, anchor)


class TaskTemplate(BaseModel):
    """The task each run creates (a subset of ``TaskCreate``)."""

    model_config = ConfigDict(extra="forbid")

    goal: str = Field(min_length=1, max_length=4000)
    agent_id: uuid.UUID | None = None
    context: str | None = Field(default=None, max_length=8000)
    priority: int = Field(default=100, ge=0, le=1000)
    max_duration_seconds: int | None = Field(default=None, ge=30, le=7 * 24 * 3600)

    @field_validator("goal")
    @classmethod
    def _goal(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("goal must not be blank")
        return value


class RetryPolicy(BaseModel):
    """Retries for *materializing* a run (e.g. the owner is at the active-task limit)."""

    model_config = ConfigDict(extra="forbid")

    max_attempts: int = Field(default=3, ge=1, le=5)
    backoff_seconds: int = Field(default=60, ge=10, le=3600)


class AutomationPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pause_on_failure: bool = True
    max_consecutive_failures: int = Field(default=3, ge=1, le=100)


class _ScheduleFields(BaseModel):
    @field_validator("cron_expression", check_fields=False)
    @classmethod
    def _cron(cls, value: str | None) -> str | None:
        return None if value is None else validate_cron(value)

    @field_validator("timezone", check_fields=False)
    @classmethod
    def _tz(cls, value: str | None) -> str | None:
        return None if value is None else validate_timezone(value)


class AutomationCreate(_ScheduleFields):
    model_config = ConfigDict(extra="forbid", json_schema_extra={"examples": [{
        "name": "Morning inbox digest", "cron_expression": "0 8 * * 1-5", "timezone": "Europe/Berlin",
        "task_template": {"goal": "Summarize my unread e-mails from the last 24 hours."}}]})

    name: str = Field(min_length=1, max_length=200)
    trigger_type: Literal["schedule"] = "schedule"
    cron_expression: str = Field(min_length=1, max_length=120,
                                 description="5-field cron expression; runs at most every 15 minutes")
    timezone: str = Field(default="UTC", max_length=64,
                          description="IANA time zone the schedule is evaluated in")
    task_template: TaskTemplate
    enabled: bool = True
    max_runs: int | None = Field(default=None, ge=1, le=1_000_000)
    retry_policy: RetryPolicy = Field(default_factory=RetryPolicy)
    policy: AutomationPolicy = Field(default_factory=AutomationPolicy)


class AutomationUpdate(_ScheduleFields):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    cron_expression: str | None = Field(default=None, min_length=1, max_length=120)
    timezone: str | None = Field(default=None, max_length=64)
    task_template: TaskTemplate | None = None
    enabled: bool | None = None
    max_runs: int | None = Field(default=None, ge=1, le=1_000_000)
    retry_policy: RetryPolicy | None = None
    policy: AutomationPolicy | None = None
    expected_version: int | None = Field(default=None, ge=1,
                                         description="Optimistic concurrency: reject if the version changed")

    @model_validator(mode="after")
    def _not_null(self) -> AutomationUpdate:
        required = ("name", "cron_expression", "timezone", "task_template", "enabled", "retry_policy",
                    "policy")
        for name in required:
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} cannot be null")
        return self


class AutomationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    trigger_type: str
    cron_expression: str
    timezone: str
    task_template: dict[str, Any]
    enabled: bool
    max_runs: int | None
    run_count: int
    retry_policy: dict[str, Any]
    policy: dict[str, Any]
    consecutive_failures: int
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_status: str | None
    disabled_reason: str | None
    version: int
    created_at: datetime
    updated_at: datetime


class AutomationRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    automation_id: uuid.UUID
    scheduled_for: datetime
    trigger: str
    task_id: uuid.UUID | None
    status: str
    error: str | None
    attempts: int
    next_attempt_at: datetime | None
    created_at: datetime
    finished_at: datetime | None
