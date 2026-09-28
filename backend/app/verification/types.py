"""Machine-readable verification evidence (never a model's natural-language claim)."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

from app.common.enums import VerificationStatus


class VerificationMethod:
    READ_BACK = "read_back"
    STATE_COMPARISON = "state_comparison"
    EXPECTED_FIELDS = "expected_fields"
    RESOURCE_EXISTS = "resource_exists"
    PROVIDER_CONFIRMATION = "provider_confirmation"
    BROWSER_STATE = "browser_state"
    OUTPUT_SCHEMA = "output_schema"
    CHECKSUM = "checksum"
    RESPONSE_CONSISTENCY = "response_consistency"


class Difference(BaseModel):
    field: str
    expected: Any = None
    observed: Any = None


class VerificationOutcome(BaseModel):
    status: VerificationStatus
    method: str
    expected: dict[str, Any] = Field(default_factory=dict)
    observed: dict[str, Any] = Field(default_factory=dict)
    differences: list[Difference] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    retryable: bool = Field(default=False, description="True when a later read-back may succeed (eventual consistency)")

    @property
    def passed(self) -> bool:
        return self.status == VerificationStatus.PASSED

    @classmethod
    def passed_with(cls, method: str, *, expected: dict[str, Any] | None = None,
                    observed: dict[str, Any] | None = None, evidence: dict[str, Any] | None = None
                    ) -> VerificationOutcome:
        return cls(status=VerificationStatus.PASSED, method=method, expected=expected or {},
                   observed=observed or {}, evidence=evidence or {})

    @classmethod
    def failed_with(cls, method: str, differences: list[Difference], *, expected: dict[str, Any] | None = None,
                    observed: dict[str, Any] | None = None, retryable: bool = False,
                    evidence: dict[str, Any] | None = None) -> VerificationOutcome:
        return cls(status=VerificationStatus.FAILED, method=method, differences=differences,
                   expected=expected or {}, observed=observed or {}, retryable=retryable, evidence=evidence or {})


def compare_fields(expected: dict[str, Any], observed: dict[str, Any], *, normalizers: dict[str, Any] | None = None
                   ) -> list[Difference]:
    """Field-by-field comparison with optional per-field normalisers (e.g. datetime parsing,
    case-insensitive e-mail sets)."""
    normalizers = normalizers or {}
    diffs: list[Difference] = []
    for key, exp in expected.items():
        obs = observed.get(key)
        norm = normalizers.get(key)
        left, right = (norm(exp), norm(obs)) if norm else (exp, obs)
        if left != right:
            diffs.append(Difference(field=key, expected=exp, observed=obs))
    return diffs
