"""Runtime strategy resolution: which vetted ACBE configuration applies to a task.

Only strategies that passed evaluation + safety gates and were approved can be
``canary`` or ``promoted``. Canary assignment is deterministic per subject so a
task always sees the same variant. The resulting ``StrategyConfig`` can only tune
bounded parameters (hints, retry counts, read-back timing, locator order,
retrieval weights) — it cannot touch permissions, approvals or policy.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.acbe.models import StrategyCandidate, StrategyStatus


class ToolRetryTuning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    max_attempts: int = Field(ge=1, le=5)
    base_delay_seconds: float = Field(default=2.0, ge=0.1, le=60)


class ReadbackTuning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    attempts: int = Field(ge=1, le=10)
    delay_ms: int = Field(ge=0, le=30_000)


class MemoryWeights(BaseModel):
    model_config = ConfigDict(extra="forbid")
    semantic: float = Field(default=0.45, ge=0, le=1)
    keyword: float = Field(default=0.25, ge=0, le=1)
    recency: float = Field(default=0.1, ge=0, le=1)
    importance: float = Field(default=0.2, ge=0, le=1)


class StrategyConfig(BaseModel):
    """The complete set of knobs ACBE may turn. Anything else is rejected by schema."""

    model_config = ConfigDict(extra="forbid")
    planner_hints: list[str] = Field(default_factory=list, max_length=10)
    tool_retry: dict[str, ToolRetryTuning] = Field(default_factory=dict)
    verification_readback: dict[str, ReadbackTuning] = Field(default_factory=dict)
    browser_locator_order: list[Literal["role", "label", "text", "test_id", "css"]] = Field(default_factory=list)
    memory_weights: MemoryWeights | None = None

    def merged(self, other: StrategyConfig) -> StrategyConfig:
        return StrategyConfig(
            planner_hints=list(dict.fromkeys([*self.planner_hints, *other.planner_hints]))[:10],
            tool_retry={**self.tool_retry, **other.tool_retry},
            verification_readback={**self.verification_readback, **other.verification_readback},
            browser_locator_order=other.browser_locator_order or self.browser_locator_order,
            memory_weights=other.memory_weights or self.memory_weights,
        )


class ActiveStrategy(BaseModel):
    version: str
    config: StrategyConfig


BASELINE = ActiveStrategy(version="baseline", config=StrategyConfig())


def in_rollout(subject: uuid.UUID | str, version_label: str, percentage: int) -> bool:
    bucket = int.from_bytes(hashlib.sha256(f"{version_label}:{subject}".encode()).digest()[:4], "big") % 100
    return bucket < max(0, min(100, percentage))


def override_for(source: str | None, execution_metadata: dict | None) -> ActiveStrategy | None:
    """Evaluation/experiment tasks may pin an explicit (validated) strategy so baseline and
    candidate variants can be compared on identical cases. Never honoured for user tasks."""
    if source != "evaluation" or not execution_metadata:
        return None
    raw = execution_metadata.get("strategy_override")
    if raw is None:
        return None
    label = str(execution_metadata.get("strategy_override_label", "experiment"))[:80]
    return ActiveStrategy(version=label, config=StrategyConfig.model_validate(raw))


async def resolve_task_strategy(session: AsyncSession, tenant_id: uuid.UUID, task: object) -> ActiveStrategy:
    pinned = override_for(getattr(task, "source", None), getattr(task, "execution_metadata", None))
    if pinned is not None:
        return pinned
    return await resolve_strategy(session, tenant_id, getattr(task, "id"))  # noqa: B009


async def resolve_strategy(session: AsyncSession, tenant_id: uuid.UUID, subject: uuid.UUID | str
                           ) -> ActiveStrategy:
    rows = (await session.execute(
        select(StrategyCandidate).where(
            StrategyCandidate.status.in_([StrategyStatus.PROMOTED, StrategyStatus.CANARY]),
            or_(StrategyCandidate.tenant_id.is_(None), StrategyCandidate.tenant_id == tenant_id),
        ).order_by(StrategyCandidate.tenant_id.is_(None).desc(), StrategyCandidate.promoted_at,
                   StrategyCandidate.created_at),
        execution_options={"skip_tenant_scope": True},
    )).scalars().all()
    config = StrategyConfig()
    labels: list[str] = []
    for row in rows:
        if row.status == StrategyStatus.CANARY and not in_rollout(subject, row.version_label,
                                                                   row.rollout_percentage):
            continue
        config = config.merged(StrategyConfig.model_validate(row.candidate_config))
        labels.append(row.version_label)
    return ActiveStrategy(version="+".join(labels) if labels else "baseline", config=config)
