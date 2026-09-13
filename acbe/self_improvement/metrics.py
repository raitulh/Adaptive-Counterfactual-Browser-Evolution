from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from acbe.core.types import Experiment


def improvement_gain(experiment: Experiment) -> float:
    """New Performance - Baseline Performance."""
    return experiment.improvement_gain


def improvement_efficiency(experiment: Experiment) -> float:
    """(New Performance - Baseline Performance) / Additional Token Cost."""
    additional_cost = experiment.avg_candidate_tokens - experiment.avg_baseline_tokens
    gain = experiment.improvement_gain
    if additional_cost <= 0:
        # More success for equal-or-lower cost is the best possible outcome;
        # report gain directly rather than dividing by (near) zero.
        return gain
    return gain / additional_cost


def efficiency_ratio(success_rate: float, token_cost: float) -> float:
    """Success Rate / Token Cost -- the primary efficiency metric (Section 17)."""
    if token_cost <= 0:
        return float("inf") if success_rate > 0 else 0.0
    return success_rate / token_cost


@dataclass
class SelfImprovementMetricsTracker:
    """Accumulates the counters called out in Section 15 of the
    self-improvement update across the lifetime of a ``SelfImprovementLoop``."""

    verified_improvements: int = 0
    rolled_back_improvements: int = 0
    rejected_improvements: int = 0
    needs_more_data: int = 0
    strategy_reuse_hits: int = 0
    strategy_reuse_misses: int = 0
    transfer_successes: int = 0
    transfer_failures: int = 0
    experiments: List[Experiment] = field(default_factory=list)
    improvement_times: List[float] = field(default_factory=list)

    def record_experiment(self, experiment: Experiment) -> None:
        self.experiments.append(experiment)
        if experiment.status.value == "PROMOTE":
            self.verified_improvements += 1
        elif experiment.status.value == "ROLLBACK":
            self.rolled_back_improvements += 1
        elif experiment.status.value == "REJECT":
            self.rejected_improvements += 1
        else:
            self.needs_more_data += 1

    def record_strategy_reuse(self, hit: bool) -> None:
        if hit:
            self.strategy_reuse_hits += 1
        else:
            self.strategy_reuse_misses += 1

    def record_transfer(self, success: bool) -> None:
        if success:
            self.transfer_successes += 1
        else:
            self.transfer_failures += 1

    @property
    def strategy_reuse_rate(self) -> float:
        total = self.strategy_reuse_hits + self.strategy_reuse_misses
        return (self.strategy_reuse_hits / total) if total else 0.0

    @property
    def improvement_acceptance_rate(self) -> float:
        total = self.verified_improvements + self.rejected_improvements + self.rolled_back_improvements
        return (self.verified_improvements / total) if total else 0.0

    @property
    def cross_task_transfer_rate(self) -> float:
        total = self.transfer_successes + self.transfer_failures
        return (self.transfer_successes / total) if total else 0.0

    @property
    def regression_rate(self) -> float:
        total = len(self.experiments)
        return (self.rolled_back_improvements / total) if total else 0.0

    def summary(self) -> dict:
        avg_gain = (
            sum(improvement_gain(e) for e in self.experiments) / len(self.experiments)
            if self.experiments else 0.0
        )
        return {
            "verified_improvements": self.verified_improvements,
            "rolled_back_improvements": self.rolled_back_improvements,
            "rejected_improvements": self.rejected_improvements,
            "needs_more_data": self.needs_more_data,
            "strategy_reuse_rate": round(self.strategy_reuse_rate, 4),
            "improvement_acceptance_rate": round(self.improvement_acceptance_rate, 4),
            "cross_task_transfer_rate": round(self.cross_task_transfer_rate, 4),
            "regression_rate": round(self.regression_rate, 4),
            "average_improvement_gain": round(avg_gain, 4),
        }
