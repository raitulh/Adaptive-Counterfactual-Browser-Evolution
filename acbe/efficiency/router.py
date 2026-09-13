from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from acbe.core.config import ACBEConfig


class ModelTier(str, Enum):
    DETERMINISTIC = "deterministic"   # no model call at all (cache/rule hit)
    SMALL = "small"                   # local/small model (Ollama, Qwen, ...)
    LARGE = "large"                   # frontier model, only when necessary


class ObservationDepth(str, Enum):
    MINIMAL = "minimal"      # url + page_type only
    COMPACT = "compact"      # the standard compact UI state
    DETAILED = "detailed"    # + accessibility tree / screenshot


@dataclass
class RoutingDecision:
    tier: ModelTier
    observation_depth: ObservationDepth
    reasoning_mode: str  # "fast" | "standard" | "counterfactual"
    reason: str


class ModelRouter:
    """Implements Section 8's routing table:

        Deterministic -> small/local model -> large model only when necessary

    and the adaptive-observation / adaptive-reasoning-budget rules.
    """

    def __init__(self, config: Optional[ACBEConfig] = None):
        self.config = config or ACBEConfig()

    def route(
        self,
        *,
        uncertainty: float,
        has_validated_strategy: bool,
        repeated_failure_count: int = 0,
        state_changed: bool = True,
    ) -> RoutingDecision:
        # A validated, high-confidence cached strategy means we don't need
        # to reason at all -- just replay it.
        if has_validated_strategy and uncertainty < self.config.medium_confidence_threshold:
            return RoutingDecision(
                tier=ModelTier.DETERMINISTIC,
                observation_depth=ObservationDepth.MINIMAL,
                reasoning_mode="fast",
                reason="cached_validated_strategy",
            )

        if repeated_failure_count >= 2:
            # Give up on cheap retries; this needs real counterfactual
            # reasoning, which benefits most from a stronger model.
            return RoutingDecision(
                tier=ModelTier.LARGE,
                observation_depth=ObservationDepth.DETAILED,
                reasoning_mode="counterfactual",
                reason="repeated_failure",
            )

        if uncertainty >= (1.0 - self.config.high_confidence_threshold) and uncertainty < self.config.medium_confidence_threshold:
            return RoutingDecision(
                tier=ModelTier.SMALL,
                observation_depth=ObservationDepth.COMPACT,
                reasoning_mode="standard",
                reason="medium_confidence",
            )

        if uncertainty >= self.config.medium_confidence_threshold:
            return RoutingDecision(
                tier=ModelTier.LARGE,
                observation_depth=ObservationDepth.DETAILED,
                reasoning_mode="standard",
                reason="low_confidence",
            )

        depth = ObservationDepth.MINIMAL if not state_changed else ObservationDepth.COMPACT
        return RoutingDecision(
            tier=ModelTier.SMALL,
            observation_depth=depth,
            reasoning_mode="fast",
            reason="high_confidence",
        )
