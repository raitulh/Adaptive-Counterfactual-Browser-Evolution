from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, List

from acbe.browser.base import BrowserActionError
from acbe.core.types import DataclassMixin, StepRecord, new_id, now_ts


@dataclass
class FailureFingerprint(DataclassMixin):
    fingerprint_id: str
    task_id: str
    step_id: str
    action: str
    expected_state: str
    actual_state: str
    ui_state_hash: str
    error: str
    recent_actions: List[str] = field(default_factory=list)
    failure_type: str = "TOOL_FAILURE"
    confidence: float = 0.7
    uncertainty: float = 0.3
    token_cost: int = 0
    timestamp: float = field(default_factory=now_ts)
    environment_id: str = ""
    page_type: str = ""


class FailureFingerprintBuilder:
    """Builds a ``FailureFingerprint`` from a failed step, given the small
    window of recent history needed for pattern matching later."""

    @staticmethod
    def from_exception(
        *,
        task_id: str,
        step: StepRecord,
        exc: BrowserActionError,
        recent_actions: List[str],
        environment_id: str = "",
    ) -> FailureFingerprint:
        before = step.observation_before
        return FailureFingerprint(
            fingerprint_id=new_id("fail"),
            task_id=task_id,
            step_id=step.step_id,
            action=f"{step.action.action_type.value}:{step.action.target_description}",
            expected_state=exc.expected_state or before.goal,
            actual_state=exc.actual_state or "unknown",
            ui_state_hash=before.state_hash,
            error=str(exc),
            recent_actions=recent_actions[-5:],
            failure_type=exc.error_kind,
            confidence=0.75,
            uncertainty=before.uncertainty,
            token_cost=step.tokens_input + step.tokens_output,
            environment_id=environment_id,
            page_type=before.page_type,
        )

    @staticmethod
    def from_verification_failure(
        *,
        task_id: str,
        step: StepRecord,
        recent_actions: List[str],
        environment_id: str = "",
    ) -> FailureFingerprint:
        v = step.verification
        before = step.observation_before
        return FailureFingerprint(
            fingerprint_id=new_id("fail"),
            task_id=task_id,
            step_id=step.step_id,
            action=f"{step.action.action_type.value}:{step.action.target_description}",
            expected_state=v.expected_state if v else before.goal,
            actual_state=v.actual_state if v else "unknown",
            ui_state_hash=before.state_hash,
            error=(v.detail if v and v.detail else "Verification did not confirm the expected state."),
            recent_actions=recent_actions[-5:],
            failure_type="VERIFICATION_FAILURE",
            confidence=1.0 - (v.confidence if v else 0.5),
            uncertainty=before.uncertainty,
            token_cost=step.tokens_input + step.tokens_output,
            environment_id=environment_id,
            page_type=before.page_type,
        )

    @staticmethod
    def from_episode_result(*, task_id: str, environment_id: str, result: Any) -> FailureFingerprint:
        """Shared entry point used both by ``SelfImprovementLoop`` (Task-based
        runs) and by the free-text ``ACBE.run()`` bridge (agent-driven runs):
        builds the right kind of fingerprint depending on whether the episode
        raised a ``BrowserActionError`` or simply failed goal verification."""
        recent = [f"{s.action.action_type.value}:{s.action.target_description}" for s in result.trajectory.steps]
        if result.error is not None:
            return FailureFingerprintBuilder.from_exception(
                task_id=task_id, step=result.failed_step, exc=result.error,
                recent_actions=recent, environment_id=environment_id,
            )
        return FailureFingerprintBuilder.from_verification_failure(
            task_id=task_id, step=result.failed_step,
            recent_actions=recent, environment_id=environment_id,
        )
