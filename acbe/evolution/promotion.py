"""
Promotion System (Section 13).

A candidate is promoted only when ALL of the following hold:
  * minimum sample size reached
  * statistically significant improvement (one-sided two-proportion z-test)
  * no material regression on the held-out regression suite
  * token-cost increase within the configured budget
  * (safety checks are enforced upstream by SafetyGuard / evolution levels)

This is intentionally conservative: "improved once" is never sufficient.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from acbe.core.config import ACBEConfig
from acbe.core.types import Experiment, ExperimentStatus, now_ts


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def one_sided_proportion_test(successes_a: int, n_a: int, successes_b: int, n_b: int) -> float:
    """Returns the confidence (0-1) that B's success rate is truly higher
    than A's, using a one-sided two-proportion z-test. Pure stdlib (no
    scipy dependency) via ``math.erf``."""
    if n_a == 0 or n_b == 0:
        return 0.0
    p_a, p_b = successes_a / n_a, successes_b / n_b
    p_pool = (successes_a + successes_b) / (n_a + n_b)
    if p_pool in (0.0, 1.0):
        return 1.0 if p_b > p_a else 0.0
    se = math.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b))
    if se == 0:
        return 1.0 if p_b > p_a else 0.0
    z = (p_b - p_a) / se
    return _norm_cdf(z)


@dataclass
class PromotionGate:
    config: ACBEConfig

    def evaluate(self, experiment: Experiment) -> Experiment:
        reasons = []

        if experiment.candidate_trials < self.config.promotion_min_sample_size:
            experiment.status = ExperimentStatus.NEEDS_MORE_DATA
            experiment.decision_reason = (
                f"candidate_trials={experiment.candidate_trials} < "
                f"minimum_sample_size={self.config.promotion_min_sample_size}"
            )
            experiment.decided_at = now_ts()
            return experiment

        confidence = one_sided_proportion_test(
            experiment.baseline_successes, experiment.baseline_trials,
            experiment.candidate_successes, experiment.candidate_trials,
        )

        if experiment.regression_trials > 0 and experiment.regression_rate > self.config.promotion_max_regression_rate:
            experiment.status = ExperimentStatus.ROLLBACK
            experiment.decision_reason = (
                f"regression_rate={experiment.regression_rate:.3f} exceeds "
                f"max_allowed={self.config.promotion_max_regression_rate:.3f}"
            )
            experiment.decided_at = now_ts()
            return experiment

        if experiment.improvement_gain < self.config.promotion_min_improvement_gain:
            reasons.append(
                f"improvement_gain={experiment.improvement_gain:.3f} < "
                f"min_required={self.config.promotion_min_improvement_gain:.3f}"
            )

        if confidence < self.config.promotion_min_confidence:
            reasons.append(f"confidence={confidence:.3f} < min_required={self.config.promotion_min_confidence:.3f}")

        if experiment.token_increase_ratio > self.config.promotion_max_token_increase_ratio:
            reasons.append(
                f"token_increase_ratio={experiment.token_increase_ratio:.2f}x exceeds "
                f"max_allowed={self.config.promotion_max_token_increase_ratio:.2f}x "
                "(improvement not cost-efficient)"
            )

        experiment.decided_at = now_ts()
        if reasons:
            experiment.status = ExperimentStatus.REJECT
            experiment.decision_reason = "; ".join(reasons)
        else:
            experiment.status = ExperimentStatus.PROMOTE
            experiment.decision_reason = (
                f"improvement_gain={experiment.improvement_gain:.3f}, confidence={confidence:.3f}, "
                f"token_increase_ratio={experiment.token_increase_ratio:.2f}x -- all thresholds satisfied"
            )
        return experiment
