from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional


@dataclass
class ACBEConfig:
    """Central configuration object threaded through the whole system.

    Every weight / threshold called out in the specification as
    "configurable" lives here (or in a nested config) rather than being a
    magic number buried in a module.
    """

    # storage
    db_path: str = ".acbe/acbe.db"
    trace_dir: str = ".acbe/traces"

    # feature flags
    memory_enabled: bool = True
    self_improvement_enabled: bool = True
    token_optimization_enabled: bool = True

    # candidate ranking weights (Section 7 of the spec)
    weight_success_probability: float = 1.0
    weight_transfer_probability: float = 0.5
    weight_robustness: float = 0.3
    weight_token_cost: float = 0.4
    weight_latency: float = 0.2
    weight_risk: float = 0.6
    weight_complexity: float = 0.2

    # cheap-competition funnel sizes (10 -> 6 -> 3 -> 2 -> 1)
    funnel_deterministic_keep: int = 6
    funnel_cheap_keep: int = 3
    funnel_small_model_keep: int = 2

    # promotion gate thresholds
    promotion_min_sample_size: int = 20
    promotion_min_confidence: float = 0.90
    promotion_max_regression_rate: float = 0.05
    promotion_max_token_increase_ratio: float = 1.5
    promotion_min_improvement_gain: float = 0.03

    # token / efficiency
    high_confidence_threshold: float = 0.85
    medium_confidence_threshold: float = 0.5

    # safety: components that may never be modified without human approval
    protected_components: tuple = (
        "evaluator",
        "safety_gate",
        "benchmark_definitions",
        "promotion_thresholds",
        "audit_logs",
        "permission_system",
        "security_controls",
    )
    domain_allowlist: Optional[list] = None  # None => allow all (dev mode)
    require_confirmation_for: tuple = (
        "financial_transaction",
        "credential_change",
        "destructive_delete",
        "security_sensitive_operation",
    )

    extra: Dict[str, Any] = field(default_factory=dict)

    def ensure_dirs(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        Path(self.trace_dir).mkdir(parents=True, exist_ok=True)
