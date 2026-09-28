"""Schedule validation and next-run computation (pure functions, no I/O)."""

from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from app.automations.schemas import (
    AutomationCreate,
    AutomationUpdate,
    RetryPolicy,
    TaskTemplate,
    next_run_after,
    next_run_from,
    validate_cron,
    validate_timezone,
)


# ---------------------------------------------------------------------------- cron validation
@pytest.mark.parametrize("expr", ["*/15 * * * *", "0 9 * * 1-5", "0,30 * * * *", "45 23 * * *", "0 0 1 * *",
                                  "0 0 29 2 *"])
def test_valid_cron_expressions_are_accepted(expr: str) -> None:
    assert validate_cron(expr) == expr


def test_cron_is_normalized_and_macros_expand() -> None:
    assert validate_cron("  0   9  * *   1-5 ") == "0 9 * * 1-5"
    assert validate_cron("@hourly") == "0 * * * *"
    assert validate_cron("@daily") == "0 0 * * *"


@pytest.mark.parametrize("expr", ["* * * * *", "*/5 * * * *", "*/14 * * * *", "0,10 * * * *", "0,5 9 * * *",
                                  "50,55 23 * * *"])
def test_too_frequent_schedules_are_rejected(expr: str) -> None:
    with pytest.raises(ValueError, match="at most every 15 minutes"):
        validate_cron(expr)


def test_wraparound_across_midnight_counts_as_too_frequent() -> None:
    # 23:55 then 00:00 the next day is only 5 minutes apart.
    with pytest.raises(ValueError, match="at most every 15 minutes"):
        validate_cron("0,55 0,23 * * *")


@pytest.mark.parametrize("expr", ["", "not a cron", "61 * * * *", "* * * *", "0 0 * * * *", "@reboot",
                                  "0 25 * * *"])
def test_malformed_cron_is_rejected(expr: str) -> None:
    with pytest.raises(ValueError):
        validate_cron(expr)


def test_cron_that_never_fires_is_rejected() -> None:
    with pytest.raises(ValueError, match="never matches"):
        validate_cron("0 0 30 2 *")


# ---------------------------------------------------------------------------- time zones
@pytest.mark.parametrize("tz", ["UTC", "Europe/Berlin", "America/New_York", "Asia/Dhaka"])
def test_valid_timezones(tz: str) -> None:
    assert validate_timezone(tz) == tz


@pytest.mark.parametrize("tz", ["", "Mars/Olympus_Mons", "../../etc/passwd", "/etc/localtime", "GMT+25"])
def test_invalid_timezones(tz: str) -> None:
    with pytest.raises(ValueError):
        validate_timezone(tz)


# ---------------------------------------------------------------------------- schemas
def _create(**overrides: object) -> AutomationCreate:
    body: dict[str, object] = {"name": "Digest", "cron_expression": "0 8 * * *", "timezone": "UTC",
                               "task_template": {"goal": "Summarize my inbox"}}
    body.update(overrides)
    return AutomationCreate.model_validate(body)


def test_create_schema_rejects_too_frequent_and_bad_timezone() -> None:
    with pytest.raises(ValidationError, match="at most every 15 minutes"):
        _create(cron_expression="*/10 * * * *")
    with pytest.raises(ValidationError, match="unknown time zone"):
        _create(timezone="Nowhere/Land")


def test_create_schema_defaults_and_limits() -> None:
    body = _create()
    assert body.policy.pause_on_failure is True and body.policy.max_consecutive_failures == 3
    assert 1 <= body.retry_policy.max_attempts <= 5
    with pytest.raises(ValidationError):
        RetryPolicy(max_attempts=6)
    with pytest.raises(ValidationError):
        TaskTemplate(goal="x" * 4001)
    with pytest.raises(ValidationError):
        TaskTemplate(goal="   ")
    with pytest.raises(ValidationError):
        _create(task_template={"goal": "ok", "unexpected": 1})
    with pytest.raises(ValidationError):
        _create(trigger_type="webhook")


def test_update_schema_rejects_explicit_nulls_for_required_fields() -> None:
    assert AutomationUpdate(max_runs=None).model_fields_set == {"max_runs"}
    with pytest.raises(ValidationError):
        AutomationUpdate(name=None)
    with pytest.raises(ValidationError):
        AutomationUpdate(cron_expression="* * * * *")


# ---------------------------------------------------------------------------- next run / DST
def _utc(*args: int) -> datetime:
    return datetime(*args, tzinfo=UTC)


def test_next_run_is_computed_in_the_automation_timezone_and_stored_utc() -> None:
    nxt = next_run_after("0 9 * * *", "Europe/Berlin", _utc(2026, 1, 10, 12, 0))
    assert nxt == _utc(2026, 1, 11, 8, 0)  # 09:00 CET
    assert nxt.tzinfo is not None and nxt.utcoffset() == timedelta(0)
    nxt = next_run_after("0 9 * * *", "Europe/Berlin", _utc(2026, 7, 10, 12, 0))
    assert nxt == _utc(2026, 7, 11, 7, 0)  # 09:00 CEST


def test_daily_run_keeps_local_wall_clock_across_spring_forward() -> None:
    tz = "America/New_York"  # DST starts 2026-03-08 02:00 local
    first = next_run_after("0 9 * * *", tz, _utc(2026, 3, 7, 0, 0))
    second = next_run_after("0 9 * * *", tz, first)
    third = next_run_after("0 9 * * *", tz, second)
    assert first == _utc(2026, 3, 7, 14, 0)  # 09:00 EST
    assert second == _utc(2026, 3, 8, 13, 0)  # 09:00 EDT
    assert third == _utc(2026, 3, 9, 13, 0)


def test_time_skipped_by_spring_forward_fires_exactly_once() -> None:
    tz = "America/New_York"
    runs = [next_run_after("30 2 * * *", tz, _utc(2026, 3, 7, 12, 0))]
    for _ in range(2):
        runs.append(next_run_after("30 2 * * *", tz, runs[-1]))
    # 02:30 does not exist on 2026-03-08; it runs at the equivalent instant (03:30 EDT).
    assert runs == [_utc(2026, 3, 8, 7, 30), _utc(2026, 3, 9, 6, 30), _utc(2026, 3, 10, 6, 30)]


def test_repeated_hour_on_fall_back_fires_once() -> None:
    tz = "America/New_York"  # 01:00-02:00 local happens twice on 2026-11-01
    first = next_run_after("30 1 * * *", tz, _utc(2026, 10, 31, 12, 0))
    second = next_run_after("30 1 * * *", tz, first)
    assert first == _utc(2026, 11, 1, 5, 30)  # first 01:30 (EDT)
    assert second == _utc(2026, 11, 2, 6, 30)  # next day 01:30 (EST); no second run on 11-01


def test_quarter_hour_schedule_is_strictly_increasing_across_dst() -> None:
    tz = "Europe/Berlin"
    for start in (_utc(2026, 3, 29, 0, 0), _utc(2026, 10, 25, 0, 0)):
        runs = [start]
        for _ in range(16):
            runs.append(next_run_after("*/15 * * * *", tz, runs[-1]))
        gaps = [b - a for a, b in itertools.pairwise(runs[1:])]
        assert all(gap >= timedelta(minutes=15) for gap in gaps)
        assert len(set(runs)) == len(runs)


def test_next_run_from_allows_at_most_one_catch_up() -> None:
    now = _utc(2026, 5, 1, 12, 7)
    missed_slot = _utc(2026, 4, 28, 9, 0)  # scheduler was down for days
    nxt = next_run_from("0 * * * *", "UTC", now=now, after=missed_slot)
    assert nxt == _utc(2026, 5, 1, 13, 0)
    assert next_run_from("0 * * * *", "UTC", now=now) == _utc(2026, 5, 1, 13, 0)
