from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from acbe.core.types import DataclassMixin, new_id, now_ts


class StrategyLifecycle(str, Enum):
    DRAFT = "DRAFT"
    CANDIDATE = "CANDIDATE"
    EXPERIMENTAL = "EXPERIMENTAL"
    VALIDATED = "VALIDATED"
    PROMOTED = "PROMOTED"
    MONITORED = "MONITORED"
    DEPRECATED = "DEPRECATED"


@dataclass
class Strategy(DataclassMixin):
    """A versioned, reusable recovery/action strategy.

    ``actions`` is a small ordered list of parameter dicts describing *how*
    to perform the step differently (e.g. which locator strategy to use,
    whether to wait first, whether to add a pre-click verification).
    """

    strategy_id: str
    failure_pattern: str                 # a FailureType value, e.g. "WRONG_ELEMENT"
    preconditions: List[str] = field(default_factory=list)
    actions: List[Dict[str, Any]] = field(default_factory=list)
    verification: List[str] = field(default_factory=list)
    expected_gain: float = 0.0
    estimated_token_cost: int = 0
    risk: float = 0.2
    version: str = "1.0"
    parent_strategy_id: Optional[str] = None

    # runtime statistics, updated as the strategy is tried/promoted
    lifecycle: StrategyLifecycle = StrategyLifecycle.DRAFT
    trials: int = 0
    successes: int = 0
    token_costs_observed: List[int] = field(default_factory=list)
    environments_seen: List[str] = field(default_factory=list)
    transfer_trials: int = 0
    transfer_successes: int = 0
    created_at: float = field(default_factory=now_ts)
    last_validated_at: Optional[float] = None

    @property
    def success_rate(self) -> float:
        return (self.successes / self.trials) if self.trials else 0.0

    @property
    def transfer_success_rate(self) -> float:
        return (self.transfer_successes / self.transfer_trials) if self.transfer_trials else 0.0

    @property
    def avg_token_cost(self) -> float:
        return (sum(self.token_costs_observed) / len(self.token_costs_observed)) if self.token_costs_observed else float(self.estimated_token_cost)

    def record_trial(self, success: bool, token_cost: int, environment_id: str, is_transfer: bool = False) -> None:
        self.trials += 1
        if success:
            self.successes += 1
        self.token_costs_observed.append(token_cost)
        if environment_id not in self.environments_seen:
            self.environments_seen.append(environment_id)
        if is_transfer:
            self.transfer_trials += 1
            if success:
                self.transfer_successes += 1
        self.last_validated_at = now_ts()

    @staticmethod
    def new(failure_pattern: str, locator_strategy: str, *, parent_id: Optional[str] = None,
            extra_actions: Optional[List[Dict[str, Any]]] = None, risk: float = 0.2,
            estimated_token_cost: int = 400) -> "Strategy":
        actions: List[Dict[str, Any]] = [{"type": "reattempt", "locator_strategy": locator_strategy}]
        if extra_actions:
            actions.extend(extra_actions)
        return Strategy(
            strategy_id=new_id("strat"),
            failure_pattern=failure_pattern,
            preconditions=[f"failure_pattern == {failure_pattern}"],
            actions=actions,
            verification=["verify_before_click"] if "verify_before_click" in [a.get("locator_strategy") for a in actions] else [],
            risk=risk,
            estimated_token_cost=estimated_token_cost,
            parent_strategy_id=parent_id,
        )
