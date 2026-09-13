"""
Evaluation Engine (Sections 2 & 15).

Deliberately takes only the recorded ``Trajectory`` (a plain data object),
never the agent instance itself, so there is no way for the agent under
evaluation to influence its own grade. Deterministic checks are preferred;
an optional LLM-judge callback is used only as a fallback when nothing
deterministic applies.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from acbe.core.types import DataclassMixin, Trajectory

# Maps the (already-classified) failure taxonomy onto the broader
# evaluation categories the spec asks for in Section 2.
_CATEGORY_MAP = {
    "WRONG_ELEMENT": "observation",
    "WRONG_ACTION": "reasoning",
    "WRONG_SEQUENCE": "planning",
    "STATE_MISUNDERSTANDING": "observation",
    "MISSING_INFORMATION": "planning",
    "PAGE_CHANGED": "environment",
    "TOOL_FAILURE": "tool_use",
    "PLANNING_FAILURE": "planning",
    "REASONING_FAILURE": "reasoning",
    "VERIFICATION_FAILURE": "verification",
    "CONTEXT_FAILURE": "context",
    "TOKEN_BUDGET_FAILURE": "reasoning",
    "ENVIRONMENT_FAILURE": "environment",
}


@dataclass
class EvaluationResult(DataclassMixin):
    trajectory_id: str
    completed: bool
    earliest_failure_step_id: Optional[str] = None
    failure_category: Optional[str] = None
    failure_type: Optional[str] = None
    severity: float = 0.0
    confidence: float = 1.0
    method: str = "deterministic"
    detail: str = ""


LLMJudge = Callable[[Trajectory], EvaluationResult]


class Evaluator:
    def __init__(self, llm_judge: Optional[LLMJudge] = None):
        self._llm_judge = llm_judge

    def evaluate(self, trajectory: Trajectory) -> EvaluationResult:
        if trajectory.success:
            return EvaluationResult(
                trajectory_id=trajectory.trajectory_id,
                completed=True,
                severity=0.0,
                confidence=1.0,
                method="deterministic",
                detail="Task completed and verification confirmed the goal state.",
            )

        for step in trajectory.steps:
            if not step.success:
                fingerprint_type = None
                if step.verification and not step.verification.verified:
                    fingerprint_type = "VERIFICATION_FAILURE"
                category = _CATEGORY_MAP.get(fingerprint_type or "TOOL_FAILURE", "tool_use")
                severity = 1.0 if step is trajectory.steps[0] else 0.6
                return EvaluationResult(
                    trajectory_id=trajectory.trajectory_id,
                    completed=False,
                    earliest_failure_step_id=step.step_id,
                    failure_category=category,
                    failure_type=fingerprint_type,
                    severity=severity,
                    confidence=0.9,
                    method="deterministic",
                    detail=f"Earliest meaningful failure at step {step.step_id}.",
                )

        if self._llm_judge:
            return self._llm_judge(trajectory)

        return EvaluationResult(
            trajectory_id=trajectory.trajectory_id,
            completed=False,
            severity=0.5,
            confidence=0.4,
            method="deterministic",
            detail="Task marked unsuccessful but no failed step was recorded; "
                    "likely an unverified goal state.",
        )

    def annotate_with_fingerprint(self, result: EvaluationResult, failure_type: str) -> EvaluationResult:
        """Refine a deterministic result once the failure pipeline has
        produced a full ``FailureFingerprint`` (which knows the concrete
        taxonomy label, not just 'a verification failed')."""
        result.failure_type = failure_type
        result.failure_category = _CATEGORY_MAP.get(failure_type, result.failure_category)
        return result
