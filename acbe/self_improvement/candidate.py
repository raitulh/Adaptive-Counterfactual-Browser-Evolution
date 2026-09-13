from __future__ import annotations

from typing import List, Optional

from acbe.core.config import ACBEConfig
from acbe.counterfactual.generator import CounterfactualGenerator
from acbe.failure.fingerprint import FailureFingerprint
from acbe.strategy.models import Strategy
from acbe.strategy.ranking import SmallModelScorer, rank_candidates

_generator = CounterfactualGenerator()


def generate_and_rank(
    fingerprint: FailureFingerprint,
    config: Optional[ACBEConfig] = None,
    small_model_scorer: Optional[SmallModelScorer] = None,
) -> List[Strategy]:
    """Section 6 + Section 7 chained together: generate several genuinely
    different candidates, then run the cheap-competition funnel over them."""
    candidates = _generator.generate(fingerprint)
    for c in candidates:
        c.expected_gain = 0.0  # left for the experiment stage to fill in empirically
    return rank_candidates(candidates, config, small_model_scorer)
