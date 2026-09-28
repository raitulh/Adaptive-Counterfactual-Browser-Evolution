"""Failure analysis: verified FailureRecords → fingerprinted patterns → ACBE taxonomy.

Only *verified* failures (established facts, not transient blips) of real user tasks
are learning input; evaluation tasks never are. Classification and grouping are
deterministic functions of the recorded error class / code / tool, and a pattern is
*significant* only when it recurs across enough distinct tasks inside the window.
Failures that must never be "learned around" (auth, missing scopes, policy blocks,
approval rejections, budgets, provider outages) are classified but marked not learnable.
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from acbe.failure.taxonomy import FailureType
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import ErrorClass
from app.common.time import utcnow
from app.recovery.models import FailureRecord
from app.tasks.models import Task

WRONG_ELEMENT_CODES = frozenset({"ambiguous_target", "target_not_found", "option_not_found"})
TOOL_FAILURE_CLASSES = frozenset({ErrorClass.TIMEOUT.value, ErrorClass.NETWORK_ERROR.value,
                                  ErrorClass.TRANSIENT.value, ErrorClass.TOOL_UNAVAILABLE.value,
                                  ErrorClass.RATE_LIMITED.value, ErrorClass.UNKNOWN_OUTCOME.value})
PLANNING_CLASSES = frozenset({ErrorClass.INVALID_INPUT.value, ErrorClass.CONFLICT.value})
PLANNING_CODES = frozenset({"plan_invalid", "tool_input_invalid", "arguments_too_large"})
LEARNABLE_TYPES = frozenset({FailureType.VERIFICATION_FAILURE, FailureType.PLANNING_FAILURE,
                             FailureType.TOOL_FAILURE, FailureType.WRONG_ELEMENT, FailureType.MISSING_INFORMATION})
# Never learnable, whatever the taxonomy says: these are safety/user decisions, not agent mistakes.
NON_LEARNABLE_CLASSES = frozenset({ErrorClass.AUTH_EXPIRED.value, ErrorClass.PERMISSION_DENIED.value,
                                   ErrorClass.POLICY_BLOCKED.value, ErrorClass.MODEL_ERROR.value})
NON_LEARNABLE_CODES = frozenset({"approval_rejected", "budget_exceeded", "policy_denied", "deadline_exceeded"})


def classify(error_class: str, error_code: str, tool_name: str | None) -> FailureType:
    tool = tool_name or ""
    if tool.startswith("browser.") and error_code in WRONG_ELEMENT_CODES:
        return FailureType.WRONG_ELEMENT
    if error_class == ErrorClass.VERIFICATION_FAILED.value:
        return FailureType.VERIFICATION_FAILURE
    if error_code == "budget_exceeded":
        return FailureType.TOKEN_BUDGET_FAILURE
    if error_class in PLANNING_CLASSES or error_code in PLANNING_CODES:
        return FailureType.PLANNING_FAILURE
    if error_class == ErrorClass.NEEDS_USER_INPUT.value:
        return FailureType.MISSING_INFORMATION
    if error_class in TOOL_FAILURE_CLASSES:
        return FailureType.TOOL_FAILURE
    if error_class == ErrorClass.POLICY_BLOCKED.value:
        return FailureType.WRONG_ACTION
    return FailureType.ENVIRONMENT_FAILURE


def is_learnable(failure_type: FailureType, error_class: str, error_code: str) -> bool:
    return (failure_type in LEARNABLE_TYPES and error_class not in NON_LEARNABLE_CLASSES
            and error_code not in NON_LEARNABLE_CODES)


@dataclass(slots=True)
class FailureObservation:
    """The fields of a FailureRecord the analyzer uses (decoupled from the ORM for testing)."""

    id: str
    task_id: str
    fingerprint: str
    tool_name: str | None
    error_class: str
    error_code: str
    message: str
    created_at: datetime
    strategy_version: str | None = None
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class FailurePattern:
    fingerprint: str
    tool_name: str | None
    error_class: str
    error_code: str
    failure_type: FailureType
    learnable: bool
    occurrences: int
    tasks: int
    first_seen: datetime
    last_seen: datetime
    failure_ids: list[str]
    strategy_versions: dict[str, int]
    sample_message: str
    permission_level: str | None
    significant: bool = False

    @property
    def dominant_strategy_version(self) -> str | None:
        return max(self.strategy_versions.items(), key=lambda kv: kv[1])[0] if self.strategy_versions else None

    def as_dict(self) -> dict[str, Any]:
        return {"fingerprint": self.fingerprint, "tool_name": self.tool_name, "error_class": self.error_class,
                "error_code": self.error_code, "failure_type": self.failure_type.value,
                "learnable": self.learnable, "occurrences": self.occurrences, "tasks": self.tasks,
                "first_seen": self.first_seen.isoformat(), "last_seen": self.last_seen.isoformat(),
                "significant": self.significant, "strategy_versions": self.strategy_versions,
                "sample_message": self.sample_message}


class FailureAnalyzer:
    def __init__(self, *, min_occurrences: int = 3, window: timedelta = timedelta(days=7),
                 max_records: int = 2000) -> None:
        self.min_occurrences = max(1, min_occurrences)
        self.window = window
        self.max_records = max_records

    # ------------------------------------------------------------------ pure
    def group(self, records: Iterable[FailureObservation]) -> list[FailurePattern]:
        buckets: dict[str, list[FailureObservation]] = {}
        for record in records:
            buckets.setdefault(record.fingerprint, []).append(record)
        patterns: list[FailurePattern] = []
        for fingerprint, items in buckets.items():
            items.sort(key=lambda r: r.created_at)
            head = items[-1]
            failure_type = classify(head.error_class, head.error_code, head.tool_name)
            learnable = is_learnable(failure_type, head.error_class, head.error_code)
            tasks = len({r.task_id for r in items})
            versions = Counter(r.strategy_version or "baseline" for r in items)
            permission = next((str(r.context["permission_level"]) for r in reversed(items)
                               if r.context.get("permission_level")), None)
            patterns.append(FailurePattern(
                fingerprint=fingerprint, tool_name=head.tool_name, error_class=head.error_class,
                error_code=head.error_code, failure_type=failure_type, learnable=learnable,
                occurrences=len(items), tasks=tasks, first_seen=items[0].created_at, last_seen=head.created_at,
                failure_ids=[r.id for r in items][-50:], strategy_versions=dict(versions),
                sample_message=head.message[:300], permission_level=permission,
                significant=learnable and tasks >= self.min_occurrences))
        patterns.sort(key=lambda p: (-p.tasks, -p.occurrences, p.fingerprint))
        return patterns

    # ------------------------------------------------------------------ DB
    async def load(self, session: AsyncSession, *, fingerprints: Sequence[str] | None = None,
                   since: datetime | None = None) -> list[FailureObservation]:
        """Verified failures of non-evaluation tasks in the window. The caller's session scope
        decides which tenants are visible (tenant session = one tenant, system = platform)."""
        since = since or utcnow() - self.window
        stmt = (select(FailureRecord).join(Task, Task.id == FailureRecord.task_id)
                .where(FailureRecord.verified.is_(True), FailureRecord.created_at >= since,
                       Task.source != "evaluation")
                .order_by(FailureRecord.created_at.desc()).limit(self.max_records))
        if fingerprints is not None:
            stmt = stmt.where(FailureRecord.fingerprint.in_(list(fingerprints)))
        rows = (await session.execute(stmt)).scalars().all()
        return [FailureObservation(id=str(r.id), task_id=str(r.task_id), fingerprint=r.fingerprint,
                                   tool_name=r.tool_name, error_class=r.error_class, error_code=r.error_code,
                                   message=r.message, created_at=r.created_at, strategy_version=r.strategy_version,
                                   context=dict(r.context_metadata or {})) for r in rows]

    async def analyze(self, session: AsyncSession, *, fingerprints: Sequence[str] | None = None,
                      since: datetime | None = None) -> list[FailurePattern]:
        return self.group(await self.load(session, fingerprints=fingerprints, since=since))

    async def task_fingerprints(self, session: AsyncSession, task_id: uuid.UUID) -> list[str]:
        rows = (await session.execute(select(FailureRecord.fingerprint).where(
            FailureRecord.task_id == task_id, FailureRecord.verified.is_(True)).distinct())).scalars().all()
        return list(rows)
