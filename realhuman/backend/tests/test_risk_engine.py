"""Mirrors tests/unit/scoring.test.ts in the web app — both must agree."""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.schemas.common import round_score
from app.services.risk_engine import (
    DEFAULT_POLICY,
    Policy,
    aggregate_score,
    classify_signal,
    decide,
)
from app.services.signal_engine import SIGNAL_CATALOG


@dataclass
class S:
    score: float
    weight: float


def all_(scores):
    return [S(score, d.weight) for score, d in zip(scores, SIGNAL_CATALOG.values(), strict=True)]


def test_catalog_weights_sum_to_one():
    assert sum(d.weight for d in SIGNAL_CATALOG.values()) == pytest.approx(1)


@pytest.mark.parametrize(
    ("score", "status"),
    [(0.9, "pass"), (0.75, "pass"), (0.74, "review"), (0.5, "review"), (0.49, "fail")],
)
def test_classify(score, status):
    assert classify_signal(score) == status


def test_aggregate():
    assert aggregate_score(all_([0.96, 0.94, 0.92, 0.9])) == 0.93
    assert aggregate_score([]) == 0


def test_round_score_rounds_half_up_like_javascript():
    assert round_score(0.125) == 0.13
    assert round_score(1.7) == 1
    assert round_score(-0.2) == 0


def test_decisions():
    allow = decide(all_([0.96, 0.94, 0.92, 0.9]))
    assert (allow.decision, allow.score, allow.risk) == ("allow", 0.93, "low")
    step_up = decide(all_([0.58, 0.82, 0.77, 0.52]))
    assert (step_up.decision, step_up.risk) == ("step_up", "medium")
    deny = decide(all_([0.2, 0.3, 0.4, 0.3]))
    assert (deny.decision, deny.risk) == ("deny", "high")


def test_single_failing_signal_only_downgrades():
    result = decide(all_([0.99, 0.99, 0.99, 0.4]))
    assert result.score >= DEFAULT_POLICY.allow_at
    assert (result.decision, result.risk) == ("step_up", "medium")


def test_custom_policy():
    assert decide(all_([0.7] * 4), Policy(allow_at=0.65, step_up_at=0.4)).decision == "allow"
