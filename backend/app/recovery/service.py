"""FailureClassifier → RecoveryPlanner → (RecoveryExecutor lives in the execution engine).

Decisions are deterministic functions of the error class, the tool's side-effect
profile, the external-action ledger state and the attempt/replan counters.
Side-effecting actions are never retried blindly: an ambiguous failure goes to
reconciliation first.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass, field
from typing import Any

import httpx
from pydantic import ValidationError

from app.common.enums import ErrorClass, PermissionLevel, StrEnum
from app.common.ids import stable_hash
from app.core.exceptions import (
    AppError,
    ApprovalInvalid,
    InsufficientScope,
    IntegrationError,
    IntegrationExpired,
    IntegrationNotConnected,
    IntegrationRevoked,
    ModelError,
    NeedsUserInput,
    PolicyDenied,
    ToolError,
    UnsafeURL,
)
from app.tools.base import RetryPolicy, ToolSpec


class RecoveryAction(StrEnum):
    RETRY = "retry"
    RECONCILE = "reconcile"
    REPAIR = "repair"  # re-plan with the failure as structured feedback
    REQUEST_USER = "request_user"
    BLOCK = "block"
    FAIL = "fail"


@dataclass(slots=True)
class ClassifiedFailure:
    error_class: ErrorClass
    code: str
    message: str
    retry_after: float | None = None
    # True when the request may have reached the provider and taken effect.
    ambiguous_outcome: bool = False
    questions: list[str] = field(default_factory=list)
    details: dict[str, Any] = field(default_factory=dict)

    def fingerprint(self, tool_name: str | None) -> str:
        return stable_hash(tool_name or "-", self.error_class.value, self.code)[:64]


_DEFINITIVE_BEFORE_EFFECT = {ErrorClass.INVALID_INPUT, ErrorClass.AUTH_EXPIRED, ErrorClass.PERMISSION_DENIED,
                             ErrorClass.POLICY_BLOCKED, ErrorClass.RATE_LIMITED, ErrorClass.NEEDS_USER_INPUT}


class FailureClassifier:
    def classify(self, exc: BaseException, *, side_effects: bool) -> ClassifiedFailure:
        if isinstance(exc, NeedsUserInput):
            return ClassifiedFailure(ErrorClass.NEEDS_USER_INPUT, exc.code, exc.message, questions=exc.questions,
                                     details=exc.details)
        if isinstance(exc, asyncio.TimeoutError | TimeoutError):
            return ClassifiedFailure(ErrorClass.TIMEOUT, "tool_timeout", "The action timed out",
                                     ambiguous_outcome=side_effects)
        if isinstance(exc, ValidationError):
            return ClassifiedFailure(ErrorClass.INVALID_INPUT, "tool_input_invalid",
                                     "; ".join(e["msg"] for e in exc.errors()[:5])[:500])
        if isinstance(exc, IntegrationNotConnected | IntegrationExpired | IntegrationRevoked):
            return ClassifiedFailure(ErrorClass.AUTH_EXPIRED, exc.code, exc.message, details=exc.details)
        if isinstance(exc, InsufficientScope):
            return ClassifiedFailure(ErrorClass.PERMISSION_DENIED, exc.code, exc.message, details=exc.details)
        if isinstance(exc, PolicyDenied | ApprovalInvalid | UnsafeURL):
            return ClassifiedFailure(ErrorClass.POLICY_BLOCKED, exc.code, exc.message, details=exc.details)
        if isinstance(exc, IntegrationError):
            cls = exc.error_class
            retry_after = exc.details.get("retry_after") if isinstance(exc.details, dict) else None
            ambiguous = side_effects and cls in (ErrorClass.TIMEOUT, ErrorClass.NETWORK_ERROR, ErrorClass.TRANSIENT,
                                                 ErrorClass.UNKNOWN_OUTCOME, ErrorClass.UNKNOWN)
            return ClassifiedFailure(cls, exc.code, exc.message, retry_after=float(retry_after) if retry_after else None,
                                     ambiguous_outcome=ambiguous, details={"provider": exc.provider})
        if isinstance(exc, ModelError):
            return ClassifiedFailure(exc.error_class if exc.error_class != ErrorClass.UNKNOWN else ErrorClass.MODEL_ERROR,
                                     exc.code, exc.message)
        if isinstance(exc, ToolError | AppError):
            cls = exc.error_class
            return ClassifiedFailure(cls, exc.code, exc.message, details=exc.details,
                                     ambiguous_outcome=side_effects and cls in (
                                         ErrorClass.UNKNOWN, ErrorClass.UNKNOWN_OUTCOME, ErrorClass.TIMEOUT,
                                         ErrorClass.NETWORK_ERROR, ErrorClass.TRANSIENT))
        if isinstance(exc, httpx.TimeoutException):
            return ClassifiedFailure(ErrorClass.TIMEOUT, "timeout", "The action timed out",
                                     ambiguous_outcome=side_effects)
        if isinstance(exc, httpx.HTTPError | ConnectionError | OSError):
            return ClassifiedFailure(ErrorClass.NETWORK_ERROR, "network_error", "Network error",
                                     ambiguous_outcome=side_effects)
        return ClassifiedFailure(ErrorClass.UNKNOWN, "unexpected_error", f"Unexpected {type(exc).__name__}",
                                 ambiguous_outcome=side_effects)


@dataclass(slots=True)
class RecoveryDecision:
    action: RecoveryAction
    reason: str
    delay_seconds: float = 0.0
    question: str | None = None


def backoff_delay(policy: RetryPolicy, attempt: int, retry_after: float | None = None) -> float:
    if retry_after:
        return min(policy.max_delay_seconds, max(retry_after, policy.base_delay_seconds))
    base = min(policy.max_delay_seconds, policy.base_delay_seconds * (2 ** max(0, attempt - 1)))
    return base * (1 + random.uniform(-policy.jitter, policy.jitter))  # noqa: S311


class RecoveryPlanner:
    def decide(self, failure: ClassifiedFailure, *, spec: ToolSpec, attempt: int, max_attempts: int,
               replans_used: int, max_replans: int, retry_policy: RetryPolicy | None = None) -> RecoveryDecision:
        policy = retry_policy or spec.retry_policy
        cls = failure.error_class
        writes = spec.permission_level.has_side_effects
        destructive = spec.permission_level in (PermissionLevel.DESTRUCTIVE, PermissionLevel.FINANCIAL)

        if cls == ErrorClass.NEEDS_USER_INPUT:
            return RecoveryDecision(RecoveryAction.REQUEST_USER, failure.message,
                                    question=(failure.questions or [failure.message])[0])
        if writes and (failure.ambiguous_outcome or cls == ErrorClass.UNKNOWN_OUTCOME):
            return RecoveryDecision(RecoveryAction.RECONCILE,
                                    "outcome of a side-effecting action is unknown; checking external state first")
        if cls == ErrorClass.AUTH_EXPIRED:
            return RecoveryDecision(RecoveryAction.BLOCK, "the connected account must be reconnected")
        if cls == ErrorClass.PERMISSION_DENIED:
            return RecoveryDecision(RecoveryAction.BLOCK, "additional permission (scope) is required")
        if cls == ErrorClass.POLICY_BLOCKED:
            return RecoveryDecision(RecoveryAction.FAIL, "blocked by policy")
        if cls == ErrorClass.VERIFICATION_FAILED:
            if writes:
                return RecoveryDecision(RecoveryAction.REQUEST_USER,
                                        "the action ran but verification did not match; needs review",
                                        question="The action's result did not match what was expected. "
                                                 "Please review it and confirm whether it is correct.")
            if attempt < max_attempts:
                return RecoveryDecision(RecoveryAction.RETRY, "read result failed verification",
                                        backoff_delay(policy, attempt))
            return RecoveryDecision(RecoveryAction.FAIL, "verification kept failing")
        if cls in (ErrorClass.INVALID_INPUT, ErrorClass.CONFLICT):
            if replans_used < max_replans:
                return RecoveryDecision(RecoveryAction.REPAIR, f"invalid step input ({failure.code}); re-planning")
            return RecoveryDecision(RecoveryAction.REQUEST_USER, "the step input is invalid",
                                    question=f"I couldn't complete a step: {failure.message}. How should I proceed?")
        if cls.retryable or cls == ErrorClass.MODEL_ERROR:
            if destructive:
                return RecoveryDecision(RecoveryAction.RECONCILE, "destructive action: reconcile before any retry")
            if attempt < max_attempts:
                return RecoveryDecision(RecoveryAction.RETRY, f"{cls.value}; retrying with backoff",
                                        backoff_delay(policy, attempt, failure.retry_after))
            return RecoveryDecision(RecoveryAction.FAIL, f"{cls.value}; retries exhausted")
        if not writes and attempt < min(2, max_attempts):
            return RecoveryDecision(RecoveryAction.RETRY, "unexpected error on a read; retrying once",
                                    backoff_delay(policy, attempt))
        return RecoveryDecision(RecoveryAction.FAIL, f"unrecoverable error ({failure.code})")


def is_definitive_before_effect(failure: ClassifiedFailure) -> bool:
    """True when the provider certainly did not perform the action (safe to retry later)."""
    return failure.error_class in _DEFINITIVE_BEFORE_EFFECT and not failure.ambiguous_outcome
