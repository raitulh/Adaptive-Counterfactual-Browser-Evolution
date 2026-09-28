"""FailureAnalyzer: taxonomy mapping, grouping by fingerprint and significance."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from acbe.failure.taxonomy import FailureType

from app.acbe.analysis import FailureAnalyzer, FailureObservation, classify, is_learnable

T0 = datetime(2026, 9, 1, tzinfo=UTC)


@pytest.mark.parametrize(("error_class", "code", "tool", "expected"), [
    ("verification_failed", "verification_mismatch", "calendar.create_event", FailureType.VERIFICATION_FAILURE),
    ("verification_failed", "verification_inconclusive", "gmail.send", FailureType.VERIFICATION_FAILURE),
    ("invalid_input", "tool_input_invalid", "gmail.send", FailureType.PLANNING_FAILURE),
    ("conflict", "conflict", "calendar.update_event", FailureType.PLANNING_FAILURE),
    ("model_error", "plan_invalid", None, FailureType.PLANNING_FAILURE),
    ("timeout", "tool_timeout", "calendar.find_free_slots", FailureType.TOOL_FAILURE),
    ("tool_unavailable", "provider_unavailable", "drive.search", FailureType.TOOL_FAILURE),
    ("network_error", "network_error", "gmail.search", FailureType.TOOL_FAILURE),
    ("unknown", "ambiguous_target", "browser.click", FailureType.WRONG_ELEMENT),
    ("invalid_input", "target_not_found", "browser.fill", FailureType.WRONG_ELEMENT),
    ("needs_user_input", "contact_not_found", "contacts.lookup", FailureType.MISSING_INFORMATION),
    ("policy_blocked", "budget_exceeded", "gmail.send", FailureType.TOKEN_BUDGET_FAILURE),
    ("policy_blocked", "policy_denied", "gmail.send", FailureType.WRONG_ACTION),
    ("auth_expired", "integration_expired", "calendar.find_free_slots", FailureType.ENVIRONMENT_FAILURE),
    ("permission_denied", "insufficient_scope", "calendar.create_event", FailureType.ENVIRONMENT_FAILURE),
])
def test_taxonomy_mapping(error_class: str, code: str, tool: str | None, expected: FailureType) -> None:
    assert classify(error_class, code, tool) == expected


def test_safety_and_user_decisions_are_never_learnable() -> None:
    assert is_learnable(FailureType.VERIFICATION_FAILURE, "verification_failed", "verification_mismatch")
    assert is_learnable(FailureType.TOOL_FAILURE, "timeout", "tool_timeout")
    assert not is_learnable(FailureType.ENVIRONMENT_FAILURE, "auth_expired", "integration_expired")
    assert not is_learnable(FailureType.WRONG_ACTION, "policy_blocked", "policy_denied")
    assert not is_learnable(FailureType.PLANNING_FAILURE, "policy_blocked", "approval_rejected")
    assert not is_learnable(FailureType.TOKEN_BUDGET_FAILURE, "policy_blocked", "budget_exceeded")


def _obs(i: int, *, task: str, fingerprint: str = "fp-verify", error_class: str = "verification_failed",
         code: str = "verification_mismatch", tool: str | None = "calendar.create_event",
         version: str | None = "baseline") -> FailureObservation:
    return FailureObservation(id=f"f{i}", task_id=task, fingerprint=fingerprint, tool_name=tool,
                              error_class=error_class, error_code=code, message=f"mismatch {i}",
                              created_at=T0 + timedelta(minutes=i), strategy_version=version,
                              context={"permission_level": "write"})


def test_group_by_fingerprint_counts_distinct_tasks() -> None:
    analyzer = FailureAnalyzer(min_occurrences=3)
    records = [_obs(1, task="t1"), _obs(2, task="t1"), _obs(3, task="t2"),  # t1 failed twice (retries)
               _obs(4, task="t3", fingerprint="fp-timeout", error_class="timeout", code="tool_timeout",
                    tool="calendar.find_free_slots"),
               _obs(5, task="t4", version="acbe-1234abcd-1")]
    patterns = {p.fingerprint: p for p in analyzer.group(records)}
    verify = patterns["fp-verify"]
    assert verify.failure_type == FailureType.VERIFICATION_FAILURE
    assert (verify.occurrences, verify.tasks) == (4, 3)
    assert verify.significant  # 3 distinct tasks >= 3
    assert verify.first_seen == T0 + timedelta(minutes=1) and verify.last_seen == T0 + timedelta(minutes=5)
    assert verify.failure_ids == ["f1", "f2", "f3", "f5"]
    assert verify.strategy_versions == {"baseline": 3, "acbe-1234abcd-1": 1}
    assert verify.dominant_strategy_version == "baseline"
    assert verify.permission_level == "write"
    timeout = patterns["fp-timeout"]
    assert timeout.failure_type == FailureType.TOOL_FAILURE and not timeout.significant
    assert next(p.fingerprint for p in analyzer.group(records)) == "fp-verify"  # most tasks first


def test_non_learnable_pattern_is_never_significant() -> None:
    records = [_obs(i, task=f"t{i}", fingerprint="fp-auth", error_class="auth_expired", code="integration_expired")
               for i in range(10)]
    (pattern,) = FailureAnalyzer(min_occurrences=2).group(records)
    assert pattern.tasks == 10 and not pattern.learnable and not pattern.significant
    assert pattern.as_dict()["failure_type"] == "ENVIRONMENT_FAILURE"
