from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List

# Rough, configurable per-1K-token prices, purely for cost estimation --
# not meant to track any single provider's live pricing.
DEFAULT_PRICE_PER_1K = {
    "large": 3.0,
    "small": 0.3,
    "deterministic": 0.0,
}


@dataclass
class CallRecord:
    tier: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    cache_hit: bool = False


@dataclass
class TokenTracker:
    price_per_1k: Dict[str, float] = field(default_factory=lambda: dict(DEFAULT_PRICE_PER_1K))
    calls: List[CallRecord] = field(default_factory=list)
    screenshots_taken: int = 0
    dom_observations_taken: int = 0
    observations_skipped_dedup: int = 0

    def record_call(self, tier: str, input_tokens: int, output_tokens: int,
                     latency_ms: float = 0.0, cache_hit: bool = False) -> None:
        self.calls.append(CallRecord(tier, input_tokens, output_tokens, latency_ms, cache_hit))

    def record_screenshot(self) -> None:
        self.screenshots_taken += 1

    def record_dom_observation(self) -> None:
        self.dom_observations_taken += 1

    def record_dedup_skip(self) -> None:
        self.observations_skipped_dedup += 1

    @property
    def total_input_tokens(self) -> int:
        return sum(c.input_tokens for c in self.calls)

    @property
    def total_output_tokens(self) -> int:
        return sum(c.output_tokens for c in self.calls)

    @property
    def total_tokens(self) -> int:
        return self.total_input_tokens + self.total_output_tokens

    @property
    def total_model_calls(self) -> int:
        return len([c for c in self.calls if not c.cache_hit])

    @property
    def cache_hit_rate(self) -> float:
        if not self.calls:
            return 0.0
        return sum(1 for c in self.calls if c.cache_hit) / len(self.calls)

    @property
    def estimated_cost_usd(self) -> float:
        total = 0.0
        for c in self.calls:
            if c.cache_hit:
                continue
            price = self.price_per_1k.get(c.tier, self.price_per_1k["large"])
            total += (c.input_tokens + c.output_tokens) / 1000.0 * price
        return round(total, 6)

    def summary(self) -> Dict[str, float]:
        return {
            "total_tokens": self.total_tokens,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_model_calls": self.total_model_calls,
            "cache_hit_rate": round(self.cache_hit_rate, 4),
            "estimated_cost_usd": self.estimated_cost_usd,
            "screenshots_taken": self.screenshots_taken,
            "dom_observations_taken": self.dom_observations_taken,
            "observations_skipped_dedup": self.observations_skipped_dedup,
        }
