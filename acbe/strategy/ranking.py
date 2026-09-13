"""
Cheap strategy competition (Section 7):

    N candidates -> deterministic filter -> cheap scoring -> small model
    -> sandbox/replay -> real-environment validation -> 1 winner.

Everything in this module is intentionally free of any LLM call: it exists
specifically so that most candidates are discarded *before* any expensive
reasoning happens. Only the final 1-2 survivors ever reach the sandbox
(Section 12) or a real environment.
"""

from __future__ import annotations

from typing import Callable, List, Optional

from acbe.core.config import ACBEConfig
from acbe.strategy.models import Strategy

# Static, dependency-free heuristics per locator strategy. These stand in
# for "cheap scoring" -- no model call, just prior knowledge about how
# robust each technique tends to be.
LOCATOR_HEURISTICS = {
    "role_name": {"success": 0.85, "transfer": 0.80, "token_cost": 300, "risk": 0.15, "latency": 0.2},
    "dom_role": {"success": 0.80, "transfer": 0.60, "token_cost": 250, "risk": 0.20, "latency": 0.15},
    "semantic_search": {"success": 0.75, "transfer": 0.70, "token_cost": 600, "risk": 0.25, "latency": 0.5},
    "visual_grounding": {"success": 0.70, "transfer": 0.50, "token_cost": 900, "risk": 0.35, "latency": 0.7},
    "nearby_element": {"success": 0.65, "transfer": 0.40, "token_cost": 350, "risk": 0.30, "latency": 0.25},
    "verify_before_click": {"success": 0.80, "transfer": 0.60, "token_cost": 200, "risk": 0.10, "latency": 0.3},
    "text_visual": {"success": 0.30, "transfer": 0.30, "token_cost": 150, "risk": 0.50, "latency": 0.1},
}
DEFAULT_HEURISTIC = {"success": 0.5, "transfer": 0.4, "token_cost": 400, "risk": 0.3, "latency": 0.3}


def _primary_locator(candidate: Strategy) -> str:
    for a in candidate.actions:
        if "locator_strategy" in a:
            return a["locator_strategy"]
    return "unknown"


def deterministic_filter(candidates: List[Strategy], keep: int) -> List[Strategy]:
    """Drop exact structural duplicates, then truncate to ``keep``."""
    seen = set()
    unique: List[Strategy] = []
    for c in candidates:
        sig = (c.failure_pattern, tuple(sorted(a.get("locator_strategy", a.get("type", "")) for a in c.actions)))
        if sig in seen:
            continue
        seen.add(sig)
        unique.append(c)
    return unique[:keep]


def cheap_score(candidate: Strategy, config: ACBEConfig) -> float:
    h = LOCATOR_HEURISTICS.get(_primary_locator(candidate), DEFAULT_HEURISTIC)
    complexity = len(candidate.actions) / 5.0
    normalized_token_cost = min(h["token_cost"], candidate.estimated_token_cost or h["token_cost"]) / 1000.0
    robustness = 1.0 - h["risk"]
    score = (
        config.weight_success_probability * h["success"]
        + config.weight_transfer_probability * h["transfer"]
        + config.weight_robustness * robustness
        - config.weight_token_cost * normalized_token_cost
        - config.weight_latency * h["latency"]
        - config.weight_risk * candidate.risk
        - config.weight_complexity * complexity
    )
    return score


SmallModelScorer = Callable[[Strategy], float]


def default_small_model_scorer(candidate: Strategy) -> float:
    """Stand-in for a local/small-model judgment call.

    Deterministic on purpose (so tests/CI are reproducible): it re-applies
    the same heuristics with a mild bonus for strategies that also add an
    explicit verification step, mirroring the kind of judgment a small
    model would plausibly make without needing a live model dependency.
    """
    h = LOCATOR_HEURISTICS.get(_primary_locator(candidate), DEFAULT_HEURISTIC)
    bonus = 0.05 if candidate.verification else 0.0
    return h["success"] + bonus - candidate.risk * 0.3


def rank_candidates(
    candidates: List[Strategy],
    config: Optional[ACBEConfig] = None,
    small_model_scorer: Optional[SmallModelScorer] = None,
) -> List[Strategy]:
    """Runs the full cheap-competition funnel and returns the surviving
    candidates in best-first order. The caller decides how many of the
    survivors to actually sandbox-test (Section 12 typically takes the
    top 1)."""
    config = config or ACBEConfig()
    scorer = small_model_scorer or default_small_model_scorer

    stage1 = deterministic_filter(candidates, config.funnel_deterministic_keep)
    stage2 = sorted(stage1, key=lambda c: cheap_score(c, config), reverse=True)[: config.funnel_cheap_keep]
    stage3 = sorted(stage2, key=scorer, reverse=True)[: config.funnel_small_model_keep]
    return stage3
