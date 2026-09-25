"""
Risk engine: aggregates signals into a score and applies the project policy.

A line-for-line port of `src/lib/verification/scoring.ts` in the web app, so
the dashboard, the docs and the API always agree:

- each signal is classified pass (≥ 0.75) / review (≥ 0.5) / fail;
- the aggregate is the weighted mean of resolved signals;
- aggregate ≥ allow threshold → allow, ≥ step-up threshold → step_up, else deny;
- a single failing signal can lower an allow to a step_up, never deny on its own.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from app.schemas.common import round_score
from app.schemas.verification import Decision, RiskLevel, SignalStatus

SIGNAL_PASS_AT = 0.75
SIGNAL_REVIEW_AT = 0.5


@dataclass(frozen=True)
class Policy:
    allow_at: float = 0.8
    step_up_at: float = 0.5


DEFAULT_POLICY = Policy()


class ScoredSignal(Protocol):
    @property
    def score(self) -> float: ...
    @property
    def weight(self) -> float: ...


@dataclass(frozen=True)
class RiskDecision:
    decision: Decision
    score: float
    risk: RiskLevel


def classify_signal(score: float) -> SignalStatus:
    if score >= SIGNAL_PASS_AT:
        return "pass"
    if score >= SIGNAL_REVIEW_AT:
        return "review"
    return "fail"


def aggregate_score(signals: Iterable[ScoredSignal]) -> float:
    weighted = 0.0
    total_weight = 0.0
    for signal in signals:
        weighted += signal.score * signal.weight
        total_weight += signal.weight
    if total_weight == 0:
        return 0.0
    return round_score(weighted / total_weight)


def risk_from_score(score: float, policy: Policy = DEFAULT_POLICY) -> RiskLevel:
    if score >= policy.allow_at:
        return "low"
    if score >= policy.step_up_at:
        return "medium"
    return "high"


def decide(signals: list[ScoredSignal], policy: Policy = DEFAULT_POLICY) -> RiskDecision:
    score = aggregate_score(signals)
    has_failure = any(classify_signal(signal.score) == "fail" for signal in signals)
    if score >= policy.allow_at:
        decision: Decision = "step_up" if has_failure else "allow"
    elif score >= policy.step_up_at:
        decision = "step_up"
    else:
        decision = "deny"
    risk: RiskLevel = (
        "medium"
        if decision == "step_up" and score >= policy.allow_at
        else risk_from_score(score, policy)
    )
    return RiskDecision(decision, score, risk)
