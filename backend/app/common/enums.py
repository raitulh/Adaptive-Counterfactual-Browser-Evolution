"""Cross-cutting enumerations shared by several domain modules."""

from __future__ import annotations

from enum import Enum


class StrEnum(str, Enum):
    def __str__(self) -> str:  # pragma: no cover - cosmetic
        return self.value


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"

    @property
    def rank(self) -> int:
        return _RISK_RANK[self]

    @classmethod
    def max(cls, *levels: RiskLevel) -> RiskLevel:
        return max(levels, key=lambda lvl: lvl.rank)


_RISK_RANK = {RiskLevel.LOW: 0, RiskLevel.MEDIUM: 1, RiskLevel.HIGH: 2, RiskLevel.CRITICAL: 3}


class PermissionLevel(StrEnum):
    """What class of effect a tool/action has on the outside world."""

    READ = "read"
    WRITE = "write"
    HIGH_RISK_WRITE = "high_risk_write"
    DESTRUCTIVE = "destructive"
    FINANCIAL = "financial"
    ADMIN = "admin"

    @property
    def has_side_effects(self) -> bool:
        return self is not PermissionLevel.READ

    @property
    def rank(self) -> int:
        return _PERMISSION_RANK[self]


_PERMISSION_RANK = {
    PermissionLevel.READ: 0,
    PermissionLevel.WRITE: 1,
    PermissionLevel.HIGH_RISK_WRITE: 2,
    PermissionLevel.DESTRUCTIVE: 3,
    PermissionLevel.FINANCIAL: 3,
    PermissionLevel.ADMIN: 4,
}


class TrustLevel(StrEnum):
    """Agent trust model: provenance decides how data may influence execution."""

    TRUSTED_SYSTEM_LOGIC = "trusted_system_logic"
    CONTROLLED_AGENT_OUTPUT = "controlled_agent_output"
    UNTRUSTED_EXTERNAL_CONTENT = "untrusted_external_content"


class ErrorClass(StrEnum):
    TRANSIENT = "transient"
    TIMEOUT = "timeout"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    AUTH_EXPIRED = "auth_expired"
    PERMISSION_DENIED = "permission_denied"
    INVALID_INPUT = "invalid_input"
    TOOL_UNAVAILABLE = "tool_unavailable"
    CONFLICT = "conflict"
    VERIFICATION_FAILED = "verification_failed"
    MODEL_ERROR = "model_error"
    POLICY_BLOCKED = "policy_blocked"
    NEEDS_USER_INPUT = "needs_user_input"
    UNKNOWN_OUTCOME = "unknown_outcome"
    UNKNOWN = "unknown"

    @property
    def retryable(self) -> bool:
        return self in _RETRYABLE


_RETRYABLE = {
    ErrorClass.TRANSIENT,
    ErrorClass.TIMEOUT,
    ErrorClass.RATE_LIMITED,
    ErrorClass.NETWORK_ERROR,
    ErrorClass.TOOL_UNAVAILABLE,
}


class VerificationStatus(StrEnum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"
    INCONCLUSIVE = "inconclusive"
    NOT_APPLICABLE = "not_applicable"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ActorType(StrEnum):
    USER = "user"
    SYSTEM = "system"
    WORKER = "worker"
    AGENT = "agent"
    SCHEDULER = "scheduler"
    ADMIN = "admin"


class SystemRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"
