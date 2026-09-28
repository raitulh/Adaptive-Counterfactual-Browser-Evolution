"""Promotion gate: statistics decide improvement, safety gates can veto anything."""

from __future__ import annotations

from app.acbe.experiments import GateRow, PromotionPolicy, plan_cases, promotion_gate
from app.evaluation.cases import get_suite

POLICY = PromotionPolicy(min_sample_size=6, confidence=0.9, min_gain=0.05, max_regression_rate=0.0,
                         max_cost_increase=0.25)


def _rows(target_passes: list[bool], *, regression_passes: list[bool] | None = None, unauthorized: int = 0,
          false_completions: int = 0, cost: float = 0.01) -> list[GateRow]:
    rows = [GateRow(case_id="target", repetition=i, passed=p, false_completion=False, unauthorized_action=False,
                    cost_usd=cost, target=True, regression=False) for i, p in enumerate(target_passes)]
    for i, p in enumerate(regression_passes or [True] * 5):
        rows.append(GateRow(case_id=f"regression-{i}", repetition=0, passed=p, false_completion=False,
                            unauthorized_action=False, cost_usd=cost, target=False, regression=True))
    for row in rows[:unauthorized]:
        row.unauthorized_action = True
    for row in rows[len(rows) - false_completions:] if false_completions else []:
        row.false_completion = True
    return rows


def test_clear_improvement_passes() -> None:
    decision = promotion_gate(_rows([False] * 6), _rows([True] * 6), POLICY)
    assert decision.decision == "passed", decision.reason
    assert decision.confidence is not None and decision.confidence >= 0.9
    assert decision.gain == 1.0
    assert all(check["ok"] for check in decision.safety_checks.values())


def test_candidate_with_unauthorized_action_is_rejected_even_if_success_improves() -> None:
    candidate = _rows([True] * 6, unauthorized=1)
    candidate[0].passed = True
    decision = promotion_gate(_rows([False] * 6), candidate, POLICY)
    assert decision.decision == "rejected"
    assert "unauthorized_actions" in decision.reason
    assert decision.safety_checks["unauthorized_actions"]["ok"] is False


def test_unauthorized_actions_are_rejected_even_when_the_baseline_had_them_too() -> None:
    decision = promotion_gate(_rows([False] * 6, unauthorized=2), _rows([True] * 6, unauthorized=1), POLICY)
    assert decision.decision == "rejected" and "unauthorized_actions" in decision.reason


def test_increase_in_false_completions_is_rejected_even_if_success_improves() -> None:
    decision = promotion_gate(_rows([False] * 6), _rows([True] * 6, false_completions=1), POLICY)
    assert decision.decision == "rejected"
    assert "false_completions" in decision.reason


def test_regression_on_cases_the_baseline_passed_is_rejected() -> None:
    decision = promotion_gate(_rows([False] * 6), _rows([True] * 6, regression_passes=[True] * 4 + [False]), POLICY)
    assert decision.decision == "rejected" and "regression" in decision.reason
    assert decision.safety_checks["regression"]["regressed_cases"] == ["regression-4"]
    # Failing a regression case the baseline also failed is not a regression.
    same = promotion_gate(_rows([False] * 6, regression_passes=[True] * 4 + [False]),
                          _rows([True] * 6, regression_passes=[True] * 4 + [False]), POLICY)
    assert same.decision == "passed"


def test_unbounded_cost_increase_is_rejected() -> None:
    decision = promotion_gate(_rows([False] * 6, cost=0.01), _rows([True] * 6, cost=0.02), POLICY)
    assert decision.decision == "rejected" and "cost" in decision.reason
    within = promotion_gate(_rows([False] * 6, cost=0.01), _rows([True] * 6, cost=0.012), POLICY)
    assert within.decision == "passed"


def test_small_samples_need_more_data() -> None:
    decision = promotion_gate(_rows([False] * 3), _rows([True] * 3), POLICY)
    assert decision.decision == "needs_more_data"
    assert "minimum sample size" in decision.reason


def test_no_or_insufficient_gain_is_rejected_and_weak_evidence_needs_more_data() -> None:
    same = promotion_gate(_rows([True, False] * 5), _rows([True, False] * 5), POLICY)
    assert same.decision == "rejected" and "gain" in same.reason
    weak = promotion_gate(_rows([True] * 5 + [False] * 5), _rows([True] * 6 + [False] * 4), POLICY)
    assert weak.decision == "needs_more_data" and "confidence" in weak.reason


def test_experiment_plan_targets_the_failure_category_plus_regression() -> None:
    plan = plan_cases("VERIFICATION_FAILURE", PromotionPolicy(target_repetitions=3, regression_repetitions=1))
    assert plan.target_ids == {"core.verification_mismatch", "acbe.calendar_readback_lag"}
    assert plan.regression_ids == {c.id for c in get_suite("core")}
    reps = {p.case.id: p.repetitions for p in plan.cases}
    assert reps["acbe.calendar_readback_lag"] == 3 and reps["core.verification_mismatch"] == 3
    assert reps["core.happy_path"] == 1
    assert len(plan.cases) == len(get_suite("core")) + 1  # overlap is run once, with target repetitions
    assert plan_cases("WRONG_ELEMENT", PromotionPolicy()).target_ids == set()
