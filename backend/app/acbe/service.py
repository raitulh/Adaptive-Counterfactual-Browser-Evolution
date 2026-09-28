"""ACBE controlled-learning use-cases.

    Verified failure → FailureAnalyzer → CandidateGenerator → StrategyCandidate (draft)
      → acbe.run_experiment (evaluation, promotion gate) → passed
      → human approves a canary (P.EXPERIMENTS_MANAGE / platform admin, bounded rollout)
      → promote after the canary period if the failure rate for the fingerprint did not increase
      → or roll back at any time (immediately excluded by ``acbe.runtime.resolve_strategy``).

Production traffic never changes behaviour directly: only candidates that passed the
gate and were approved by a human reach ``canary``/``promoted``. Every transition is audited.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import ColumnElement, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.acbe.analysis import FailureAnalyzer, FailurePattern
from app.acbe.candidates import (
    CandidateGenerator,
    CandidateProposal,
    UnsafeCandidate,
    validate_candidate_config,
    version_label,
)
from app.acbe.models import StrategyCandidate, StrategyExperiment, StrategyStatus
from app.acbe.runtime import StrategyConfig
from app.audit import service as audit
from app.audit.service import AuditCategory
from app.common.context import RequestContext
from app.common.feature_flags import Flags, is_enabled, require_enabled
from app.common.pagination import apply_keyset
from app.common.time import ensure_aware, utcnow
from app.core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed
from app.organizations.rbac import P
from app.recovery.models import FailureRecord
from app.tasks.models import Task
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

OPEN_STATUSES = (StrategyStatus.DRAFT, StrategyStatus.EVALUATING, StrategyStatus.PASSED, StrategyStatus.CANARY,
                 StrategyStatus.PROMOTED)
REJECTION_COOLDOWN = timedelta(days=7)
MAX_ACTIVE_VERSION_CHARS = 80  # tasks.strategy_version / failure_records.strategy_version width


@dataclass(frozen=True, slots=True)
class RolloutPolicy:
    """The configured policy a human rollout decision is checked against."""

    max_canary_percentage: int = 50
    min_canary_period: timedelta = timedelta(hours=24)
    min_canary_tasks: int = 0
    max_failure_rate_increase: float = 0.0


DEFAULT_ROLLOUT_POLICY = RolloutPolicy()


# ---------------------------------------------------------------------------- authorization / lookup
def safe_config(config: StrategyConfig) -> StrategyConfig:
    """Re-validate a strategy against the current safety rules (typed 422 instead of a crash)."""
    try:
        return validate_candidate_config(config)
    except UnsafeCandidate as exc:
        raise ValidationFailed(f"Unsafe strategy: {exc}", code="unsafe_strategy") from exc



def can_manage(ctx: RequestContext) -> bool:
    return ctx.is_platform_admin or ctx.has(P.EXPERIMENTS_MANAGE)


def require_manager(ctx: RequestContext) -> None:
    if not can_manage(ctx):
        raise Forbidden(details={"missing_permissions": [P.EXPERIMENTS_MANAGE]})


def _visible(ctx: RequestContext) -> ColumnElement[bool]:
    return or_(StrategyCandidate.tenant_id.is_(None), StrategyCandidate.tenant_id == ctx.tenant_id)


async def get_candidate(session: AsyncSession, ctx: RequestContext, candidate_id: uuid.UUID, *,
                        lock: bool = False) -> StrategyCandidate:
    require_manager(ctx)
    stmt = select(StrategyCandidate).where(StrategyCandidate.id == candidate_id)
    if not ctx.is_platform_admin:
        stmt = stmt.where(_visible(ctx))
    if lock:
        stmt = stmt.with_for_update().execution_options(populate_existing=True)
    candidate = (await session.execute(stmt)).scalar_one_or_none()
    if candidate is None:
        raise NotFound("Strategy candidate not found")
    return candidate


def _authorize_change(ctx: RequestContext, candidate: StrategyCandidate) -> None:
    require_manager(ctx)
    if candidate.tenant_id is None and not ctx.is_platform_admin:
        raise Forbidden("Platform-wide strategies can only be changed by a platform administrator",
                        code="platform_admin_required")
    if candidate.tenant_id is not None and candidate.tenant_id != ctx.tenant_id and not ctx.is_platform_admin:
        raise NotFound("Strategy candidate not found")


async def list_candidates(session: AsyncSession, ctx: RequestContext, *, status: str | None = None,
                          cursor: str | None = None, limit: int = 50) -> list[StrategyCandidate]:
    """Visible candidates, newest first (``limit + 1`` rows for keyset pagination)."""
    require_manager(ctx)
    stmt = select(StrategyCandidate)
    if not ctx.is_platform_admin:
        stmt = stmt.where(_visible(ctx))
    if status:
        stmt = stmt.where(StrategyCandidate.status == status)
    return list((await session.execute(apply_keyset(stmt, StrategyCandidate, cursor, limit))).scalars().all())


async def list_experiments(session: AsyncSession, candidate_id: uuid.UUID) -> list[StrategyExperiment]:
    return list((await session.execute(select(StrategyExperiment).where(
        StrategyExperiment.candidate_id == candidate_id).order_by(StrategyExperiment.experiment_version.desc())
    )).scalars().all())


# ---------------------------------------------------------------------------- failure analysis → candidates
async def failure_patterns(session: AsyncSession, ctx: RequestContext, *, analyzer: FailureAnalyzer | None = None
                           ) -> list[FailurePattern]:
    """Patterns of the caller's tenant (the API session is tenant-scoped)."""
    require_manager(ctx)
    return await (analyzer or FailureAnalyzer()).analyze(session)


async def _promoted_config(session: AsyncSession, tenant_id: uuid.UUID | None) -> tuple[StrategyConfig, str]:
    stmt = (select(StrategyCandidate).where(StrategyCandidate.status == StrategyStatus.PROMOTED)
            .order_by(StrategyCandidate.tenant_id.is_(None).desc(), StrategyCandidate.promoted_at,
                      StrategyCandidate.created_at))
    stmt = stmt.where(or_(StrategyCandidate.tenant_id.is_(None), StrategyCandidate.tenant_id == tenant_id)
                      if tenant_id is not None else StrategyCandidate.tenant_id.is_(None))
    rows = (await session.execute(stmt)).scalars().all()
    config = StrategyConfig()
    for row in rows:
        config = config.merged(StrategyConfig.model_validate(row.candidate_config))
    return config, "+".join(r.version_label for r in rows) or "baseline"


async def _blocked_by_existing(session: AsyncSession, tenant_id: uuid.UUID | None, fingerprint: str) -> bool:
    tenant_filter = (StrategyCandidate.tenant_id == tenant_id) if tenant_id is not None \
        else StrategyCandidate.tenant_id.is_(None)
    rows = (await session.execute(select(StrategyCandidate.status, StrategyCandidate.updated_at).where(
        tenant_filter, StrategyCandidate.failure_fingerprint == fingerprint))).all()
    now = utcnow()
    return any(status in OPEN_STATUSES or (status == StrategyStatus.REJECTED
                                           and now - ensure_aware(updated) < REJECTION_COOLDOWN)
               for status, updated in rows)


async def create_candidate(session: AsyncSession, *, tenant_id: uuid.UUID | None, pattern: FailurePattern,
                           proposal: CandidateProposal, failed_config: StrategyConfig,
                           created_by: str = "acbe") -> StrategyCandidate:
    """Persist a validated proposal as a draft candidate (caller commits)."""
    patch = validate_candidate_config(proposal.patch)
    existing = int((await session.execute(select(func.count()).select_from(StrategyCandidate).where(
        StrategyCandidate.version_label.like(f"acbe-{pattern.fingerprint[:8]}-%")))).scalar_one())
    candidate = StrategyCandidate(
        tenant_id=tenant_id, scope=proposal.scope[:128], failure_type=proposal.failure_type.value,
        failure_fingerprint=pattern.fingerprint, source_failure_ids=pattern.failure_ids[-50:],
        failed_strategy={"version": pattern.dominant_strategy_version, "config": failed_config.model_dump()},
        candidate_config=patch.model_dump(mode="json"), rationale=proposal.rationale[:4000],
        status=StrategyStatus.DRAFT, version_label=version_label(pattern.fingerprint, existing + 1),
        created_by=created_by[:60])
    session.add(candidate)
    await session.flush()
    return candidate


async def process_task_failures(session: AsyncSession, tenant_id: uuid.UUID, task_id: uuid.UUID, *,
                                analyzer: FailureAnalyzer | None = None,
                                generator: CandidateGenerator | None = None) -> list[StrategyCandidate]:
    """Cheap, idempotent reaction to a failed task (tenant-scoped session): analyse only the
    fingerprints this task produced; for each newly significant learnable pattern without an
    open candidate, create a draft candidate and enqueue its experiment. Commits."""
    analyzer = analyzer or FailureAnalyzer()
    task = await session.get(Task, task_id)
    if task is None or task.source == "evaluation":
        return []
    fingerprints = await analyzer.task_fingerprints(session, task_id)
    if not fingerprints:
        return []
    significant = [p for p in await analyzer.analyze(session, fingerprints=fingerprints) if p.significant]
    if not significant or not await is_enabled(session, Flags.ACBE, tenant_id):
        return []
    generator = generator or CandidateGenerator()
    config, _ = await _promoted_config(session, tenant_id)
    created: list[StrategyCandidate] = []
    for pattern in significant:
        if await _blocked_by_existing(session, tenant_id, pattern.fingerprint):
            continue
        proposal = generator.propose(pattern, config)
        if proposal is None:
            continue
        try:
            async with session.begin_nested():
                candidate = await create_candidate(session, tenant_id=tenant_id, pattern=pattern,
                                                   proposal=proposal, failed_config=config)
        except IntegrityError:  # a concurrent run created the same label: it owns this pattern
            continue
        await get_job_queue().enqueue(session, JobSpec(
            queue=Queues.EVALUATION, job_type="acbe.run_experiment", payload={"candidate_id": str(candidate.id)},
            dedupe_key=f"acbe.experiment:{candidate.id}", tenant_id=tenant_id))
        audit.record(session, category=AuditCategory.EXPERIMENT, action="acbe.candidate.created",
                     tenant_id=tenant_id, actor_type="system", resource_type="strategy_candidate",
                     resource_id=candidate.id, task_id=task_id,
                     metadata={"version_label": candidate.version_label, "failure_type": candidate.failure_type,
                               "fingerprint": pattern.fingerprint, "tasks": pattern.tasks})
        created.append(candidate)
    await session.commit()
    return created


async def request_evaluation(session: AsyncSession, ctx: RequestContext, candidate_id: uuid.UUID
                             ) -> StrategyCandidate:
    candidate = await get_candidate(session, ctx, candidate_id, lock=True)
    _authorize_change(ctx, candidate)
    if candidate.status not in (StrategyStatus.DRAFT, StrategyStatus.EVALUATING):
        raise Conflict(f"A {candidate.status} candidate cannot be re-evaluated", code="invalid_candidate_state")
    await get_job_queue().enqueue(session, JobSpec(
        queue=Queues.EVALUATION, job_type="acbe.run_experiment", payload={"candidate_id": str(candidate.id)},
        dedupe_key=f"acbe.experiment:{candidate.id}", tenant_id=candidate.tenant_id))
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="acbe.candidate.evaluate",
                 resource_type="strategy_candidate", resource_id=candidate.id,
                 metadata={"version_label": candidate.version_label})
    await session.commit()
    return candidate


# ---------------------------------------------------------------------------- rollout
def _version_has(column: Any, label: str) -> ColumnElement[bool]:
    """``strategy_version`` values are '+'-joined labels; match the label as a whole element."""
    escaped = label.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return or_(column == label, column.like(f"{escaped}+%", escape="\\"), column.like(f"%+{escaped}", escape="\\"),
               column.like(f"%+{escaped}+%", escape="\\"))


async def _live_labels(session: AsyncSession, candidate: StrategyCandidate) -> list[str]:
    stmt = select(StrategyCandidate.version_label).where(
        StrategyCandidate.status.in_([StrategyStatus.CANARY, StrategyStatus.PROMOTED]),
        StrategyCandidate.id != candidate.id)
    if candidate.tenant_id is not None:
        stmt = stmt.where(or_(StrategyCandidate.tenant_id.is_(None),
                              StrategyCandidate.tenant_id == candidate.tenant_id))
    return list((await session.execute(stmt)).scalars().all())


async def approve_canary(session: AsyncSession, ctx: RequestContext, candidate_id: uuid.UUID,
                         rollout_percentage: int, *, policy: RolloutPolicy = DEFAULT_ROLLOUT_POLICY
                         ) -> StrategyCandidate:
    """Human rollout decision: ``passed`` → ``canary`` (or adjust a running canary's percentage)."""
    candidate = await get_candidate(session, ctx, candidate_id, lock=True)
    _authorize_change(ctx, candidate)
    await require_enabled(session, Flags.ACBE, candidate.tenant_id)
    if candidate.status not in (StrategyStatus.PASSED, StrategyStatus.CANARY):
        raise Conflict("Only a candidate that passed evaluation can enter a canary", code="invalid_candidate_state",
                       details={"status": candidate.status})
    if not 1 <= rollout_percentage <= policy.max_canary_percentage:
        raise ValidationFailed(f"Canary rollout must be between 1 and {policy.max_canary_percentage}%",
                               details={"max_canary_percentage": policy.max_canary_percentage})
    safe_config(StrategyConfig.model_validate(candidate.candidate_config))
    labels = [*await _live_labels(session, candidate), candidate.version_label]
    if len("+".join(labels)) > MAX_ACTIVE_VERSION_CHARS:
        raise Conflict("Too many strategies are live for this scope; retire or roll one back first",
                       code="too_many_live_strategies")
    previous = candidate.status
    candidate.status = StrategyStatus.CANARY
    candidate.rollout_percentage = rollout_percentage
    if previous != StrategyStatus.CANARY:
        candidate.approved_by = ctx.user_id
        candidate.approved_at = utcnow()
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="acbe.canary.approved",
                 resource_type="strategy_candidate", resource_id=candidate.id,
                 metadata={"version_label": candidate.version_label, "rollout_percentage": rollout_percentage,
                           "previous_status": previous, "platform_wide": candidate.tenant_id is None})
    await session.commit()
    return candidate


async def canary_health(session: AsyncSession, candidate: StrategyCandidate) -> dict[str, Any]:
    """Failure rate of the candidate's fingerprint on canary tasks vs the rest since approval.
    Reviewed cross-tenant read: a platform-wide candidate aggregates across tenants; a tenant
    candidate is filtered explicitly to its tenant (also when a platform admin acts on it)."""
    since = ensure_aware(candidate.approved_at) if candidate.approved_at else utcnow()
    opts = {"skip_tenant_scope": True}
    scope = [Task.tenant_id == candidate.tenant_id] if candidate.tenant_id is not None else []
    fscope = [FailureRecord.tenant_id == candidate.tenant_id] if candidate.tenant_id is not None else []
    in_canary_task = _version_has(Task.strategy_version, candidate.version_label)
    in_canary_failure = _version_has(FailureRecord.strategy_version, candidate.version_label)
    base_tasks = select(func.count()).select_from(Task).where(Task.created_at >= since, Task.source != "evaluation",
                                                              *scope)
    canary_tasks = int((await session.execute(base_tasks.where(in_canary_task), execution_options=opts)).scalar_one())
    other_tasks = int((await session.execute(base_tasks.where(
        or_(Task.strategy_version.is_(None), ~in_canary_task)), execution_options=opts)).scalar_one())
    base_failures = select(func.count()).select_from(FailureRecord).where(
        FailureRecord.created_at >= since, FailureRecord.verified.is_(True),
        FailureRecord.fingerprint == candidate.failure_fingerprint, *fscope)
    canary_failures = int((await session.execute(base_failures.where(in_canary_failure),
                                                 execution_options=opts)).scalar_one())
    other_failures = int((await session.execute(base_failures.where(
        or_(FailureRecord.strategy_version.is_(None), ~in_canary_failure)), execution_options=opts)).scalar_one())
    canary_rate = canary_failures / canary_tasks if canary_tasks else 0.0
    baseline_rate = other_failures / other_tasks if other_tasks else 0.0
    return {"since": since.isoformat(), "canary_tasks": canary_tasks, "canary_failures": canary_failures,
            "canary_failure_rate": round(canary_rate, 4), "baseline_tasks": other_tasks,
            "baseline_failures": other_failures, "baseline_failure_rate": round(baseline_rate, 4)}


async def promote(session: AsyncSession, ctx: RequestContext, candidate_id: uuid.UUID, *,
                  policy: RolloutPolicy = DEFAULT_ROLLOUT_POLICY) -> StrategyCandidate:
    candidate = await get_candidate(session, ctx, candidate_id, lock=True)
    _authorize_change(ctx, candidate)
    await require_enabled(session, Flags.ACBE, candidate.tenant_id)
    if candidate.status != StrategyStatus.CANARY or candidate.approved_at is None:
        raise Conflict("Only a canary can be promoted", code="invalid_candidate_state",
                       details={"status": candidate.status})
    elapsed = utcnow() - ensure_aware(candidate.approved_at)
    if elapsed < policy.min_canary_period:
        raise Conflict("The canary period has not finished yet", code="canary_period_active",
                       details={"remaining_seconds": int((policy.min_canary_period - elapsed).total_seconds())})
    health = await canary_health(session, candidate)
    if health["canary_tasks"] < policy.min_canary_tasks:
        raise Conflict("Not enough canary traffic to judge the strategy yet", code="canary_insufficient_traffic",
                       details=health)
    if health["canary_failure_rate"] > health["baseline_failure_rate"] + policy.max_failure_rate_increase:
        raise Conflict("The canary increased the failure rate for this pattern; roll it back instead",
                       code="canary_failure_rate_increased", details=health)
    candidate.status = StrategyStatus.PROMOTED
    candidate.rollout_percentage = 100
    candidate.promoted_at = utcnow()
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="acbe.promoted",
                 resource_type="strategy_candidate", resource_id=candidate.id,
                 metadata={"version_label": candidate.version_label, "canary": health,
                           "platform_wide": candidate.tenant_id is None})
    await session.commit()
    return candidate


async def rollback(session: AsyncSession, ctx: RequestContext, candidate_id: uuid.UUID, reason: str
                   ) -> StrategyCandidate:
    """Immediately take a live (or approved) strategy out of service. Allowed even when ACBE is disabled."""
    candidate = await get_candidate(session, ctx, candidate_id, lock=True)
    _authorize_change(ctx, candidate)
    if candidate.status not in (StrategyStatus.CANARY, StrategyStatus.PROMOTED, StrategyStatus.PASSED):
        raise Conflict(f"A {candidate.status} candidate cannot be rolled back", code="invalid_candidate_state")
    previous = candidate.status
    candidate.status = StrategyStatus.ROLLED_BACK
    candidate.rollout_percentage = 0
    candidate.rolled_back_at = utcnow()
    candidate.rollback_reason = reason[:2000]
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="acbe.rolled_back",
                 resource_type="strategy_candidate", resource_id=candidate.id,
                 metadata={"version_label": candidate.version_label, "previous_status": previous,
                           "reason": reason[:300]})
    await session.commit()
    return candidate


# ---------------------------------------------------------------------------- generic experiments
async def register_experiment_strategy(session: AsyncSession, ctx: RequestContext, *, experiment_id: uuid.UUID,
                                       tenant_id: uuid.UUID | None, variant: str, config: StrategyConfig,
                                       rationale: str) -> StrategyCandidate:
    """A generic experiment's winner becomes a ``passed`` strategy candidate so it follows the same
    human-approved canary → promote → rollback path (and the same safety validation)."""
    require_manager(ctx)
    if tenant_id is None and not ctx.is_platform_admin:
        raise Forbidden("Platform-wide strategies can only be changed by a platform administrator",
                        code="platform_admin_required")
    patch = safe_config(config)
    label = f"exp-{experiment_id.hex[:8]}-{variant}"[:80]
    existing = (await session.execute(select(StrategyCandidate).where(StrategyCandidate.version_label == label)
                                      .with_for_update())).scalar_one_or_none()
    if existing is not None:
        return existing
    failed_config, failed_version = await _promoted_config(session, tenant_id)
    candidate = StrategyCandidate(
        tenant_id=tenant_id, scope="experiment", failure_type="experiment", failure_fingerprint=experiment_id.hex,
        source_failure_ids=[], failed_strategy={"version": failed_version, "config": failed_config.model_dump()},
        candidate_config=patch.model_dump(mode="json"), rationale=rationale[:4000], status=StrategyStatus.PASSED,
        version_label=label, created_by=f"experiment:{experiment_id.hex[:16]}")
    session.add(candidate)
    await session.flush()
    audit.record(session, ctx=ctx, category=AuditCategory.EXPERIMENT, action="acbe.candidate.from_experiment",
                 resource_type="strategy_candidate", resource_id=candidate.id,
                 metadata={"experiment_id": str(experiment_id), "variant": variant, "version_label": label})
    return candidate

