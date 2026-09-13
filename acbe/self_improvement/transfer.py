from __future__ import annotations

from dataclasses import dataclass, field
from typing import List

from acbe.core.types import DataclassMixin, now_ts
from acbe.memory.base import StrategyMemory
from acbe.strategy.models import Strategy, StrategyLifecycle


@dataclass
class TransferAttempt(DataclassMixin):
    strategy_id: str
    failure_pattern: str
    target_environment: str
    transfer_confidence: float
    applied: bool
    success: bool = False
    timestamp: float = field(default_factory=now_ts)


class CrossTaskTransfer:
    """Retrieve -> check similarity -> estimate confidence -> test ->
    validate -> update statistics (Section 10)."""

    def __init__(self, memory: StrategyMemory):
        self.memory = memory
        self.attempts: List[TransferAttempt] = []

    async def find_transferable(
        self, failure_pattern: str, target_environment: str, min_success_rate: float = 0.6,
    ) -> List[Strategy]:
        return await self.memory.retrieve(
            failure_pattern,
            environment_id=target_environment,
            min_success_rate=min_success_rate,
            lifecycle=[StrategyLifecycle.PROMOTED.value, StrategyLifecycle.MONITORED.value, StrategyLifecycle.VALIDATED.value],
        )

    def estimate_confidence(self, strategy: Strategy, target_environment: str) -> float:
        if target_environment in strategy.environments_seen:
            return strategy.success_rate
        # Never blindly trust transfer: unseen-environment confidence is a
        # blend of the strategy's proven success rate and its track record
        # transferring elsewhere (falling back to a conservative prior if
        # it has never been transferred before).
        prior = strategy.transfer_success_rate if strategy.transfer_trials > 0 else 0.5
        return round(0.5 * strategy.success_rate + 0.5 * prior, 3)

    async def apply_and_record(
        self, strategy: Strategy, failure_pattern: str, target_environment: str,
        success: bool, token_cost: int,
    ) -> TransferAttempt:
        is_transfer = target_environment not in strategy.environments_seen
        strategy.record_trial(success=success, token_cost=token_cost,
                               environment_id=target_environment, is_transfer=is_transfer)
        await self.memory.update(strategy)
        attempt = TransferAttempt(
            strategy_id=strategy.strategy_id, failure_pattern=failure_pattern,
            target_environment=target_environment,
            transfer_confidence=self.estimate_confidence(strategy, target_environment),
            applied=True, success=success,
        )
        self.attempts.append(attempt)
        return attempt

    @property
    def transfer_success_rate(self) -> float:
        if not self.attempts:
            return 0.0
        return sum(1 for a in self.attempts if a.success) / len(self.attempts)
