from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from acbe.core.types import DataclassMixin, Experiment, new_id, now_ts
from acbe.failure.fingerprint import FailureFingerprint
from acbe.self_improvement.root_cause import RootCauseAnalysis
from acbe.strategy.models import Strategy


@dataclass
class ImprovementProposal(DataclassMixin):
    proposal_id: str
    fingerprint_id: str
    failure_type: str
    root_cause: str
    candidate_strategy_ids: List[str] = field(default_factory=list)
    created_at: float = field(default_factory=now_ts)

    @staticmethod
    def new(fingerprint: FailureFingerprint, root_cause: RootCauseAnalysis, candidates: List[Strategy]) -> "ImprovementProposal":
        return ImprovementProposal(
            proposal_id=new_id("prop"),
            fingerprint_id=fingerprint.fingerprint_id,
            failure_type=fingerprint.failure_type,
            root_cause=root_cause.likely_cause,
            candidate_strategy_ids=[c.strategy_id for c in candidates],
        )


@dataclass
class ImprovementOutcome:
    """Not persisted directly (it references live objects) -- returned to
    the caller of ``run_and_improve`` so it can inspect exactly what the
    self-improvement loop concluded for this failure."""

    proposal: ImprovementProposal
    fingerprint: FailureFingerprint
    root_cause: RootCauseAnalysis
    candidates: List[Strategy]
    top_candidate: Strategy
    experiment: Experiment
    promoted_strategy: Optional[Strategy] = None
