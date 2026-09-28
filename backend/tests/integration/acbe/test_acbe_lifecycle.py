"""Candidate lifecycle: passed → canary → promoted → rolled back, with ``resolve_strategy``
reflecting every state; human authorization; canary health gate; auditing."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

import httpx
import pytest
from acbe_test_helpers import add_candidate, add_failed_task
from sqlalchemy import select

from app.acbe import service
from app.acbe.models import StrategyStatus
from app.acbe.runtime import in_rollout, resolve_strategy
from app.audit.models import AuditLog
from app.common.feature_flags import Flags, clear_cache
from app.common.models import FeatureFlag
from app.core.database import get_session_factory, system_session
from app.core.exceptions import Conflict, FeatureDisabled, Forbidden, NotFound, ValidationFailed
from app.workers.queues.models import Job

pytestmark = [pytest.mark.integration]

NO_WAIT = service.RolloutPolicy(min_canary_period=timedelta(0))


def _subjects(label: str, pct: int) -> tuple[str, str]:
    inside = next(f"task-{i}" for i in range(1000) if in_rollout(f"task-{i}", label, pct))
    outside = next(f"task-{i}" for i in range(1000) if not in_rollout(f"task-{i}", label, pct))
    return inside, outside


async def _resolve(tenant_id: uuid.UUID, subject: str) -> Any:
    async with get_session_factory()() as s:
        s.info["tenant_id"] = tenant_id
        return await resolve_strategy(s, tenant_id, subject)


async def _session(user: Any) -> Any:
    s = get_session_factory()()
    s.info["tenant_id"] = user.tenant_id
    return s


async def test_canary_promote_rollback_is_reflected_by_resolve_strategy(acbe_user: Any) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id)
    label = candidate.version_label
    inside, outside = _subjects(label, 30)
    assert (await _resolve(owner.tenant_id, inside)).version == "baseline"  # passed ≠ live

    async with await _session(owner) as s:
        with pytest.raises(ValidationFailed):
            await service.approve_canary(s, owner.ctx(), candidate.id, 90)  # above the configured canary cap
    async with await _session(owner) as s:
        live = await service.approve_canary(s, owner.ctx(), candidate.id, 30)
        assert (live.status, live.rollout_percentage, live.approved_by) == ("canary", 30, owner.user_id)
    canary = await _resolve(owner.tenant_id, inside)
    assert canary.version == label
    assert canary.config.verification_readback["calendar.create_event"].attempts == 5
    assert (await _resolve(owner.tenant_id, outside)).version == "baseline"

    async with await _session(owner) as s:
        with pytest.raises(Conflict) as early:
            await service.promote(s, owner.ctx(), candidate.id)  # default policy: 24h canary period
        assert early.value.code == "canary_period_active"
    async with await _session(owner) as s:
        promoted = await service.promote(s, owner.ctx(), candidate.id, policy=NO_WAIT)
        assert (promoted.status, promoted.rollout_percentage) == ("promoted", 100)
    assert (await _resolve(owner.tenant_id, inside)).version == label
    assert (await _resolve(owner.tenant_id, outside)).version == label
    other_tenant = await acbe_user()
    assert (await _resolve(other_tenant.tenant_id, inside)).version == "baseline"  # tenant-scoped strategy

    async with await _session(owner) as s:
        rolled = await service.rollback(s, owner.ctx(), candidate.id, "latency regression")
        assert rolled.status == "rolled_back" and rolled.rollback_reason == "latency regression"
    assert (await _resolve(owner.tenant_id, inside)).version == "baseline"
    assert (await _resolve(owner.tenant_id, outside)).config.verification_readback == {}

    async with system_session() as s:
        actions = [a.action for a in (await s.execute(select(AuditLog).where(
            AuditLog.resource_id == str(candidate.id)).order_by(AuditLog.created_at))).scalars()]
    assert actions == ["acbe.canary.approved", "acbe.promoted", "acbe.rolled_back"]


async def test_promotion_refused_when_canary_increases_the_failure_rate(acbe_user: Any) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id)
    async with await _session(owner) as s:
        await service.approve_canary(s, owner.ctx(), candidate.id, 50)
    for _ in range(2):  # canary tasks keep failing with the same fingerprint
        await add_failed_task(owner, fingerprint=candidate.failure_fingerprint, strategy_version=candidate.version_label)
    for _ in range(2):  # baseline tasks since the canary started do not
        await add_failed_task(owner, fingerprint="unrelated", strategy_version="baseline")
    async with await _session(owner) as s:
        with pytest.raises(Conflict) as refused:
            await service.promote(s, owner.ctx(), candidate.id, policy=NO_WAIT)
    assert refused.value.code == "canary_failure_rate_increased"
    assert refused.value.details["canary_failure_rate"] == 1.0
    assert refused.value.details["baseline_failure_rate"] == 0.0
    async with await _session(owner) as s:
        assert (await service.rollback(s, owner.ctx(), candidate.id, "canary unhealthy")).status == "rolled_back"


async def test_rollout_requires_a_human_with_the_right_authority(acbe_user: Any) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id)
    platform_candidate = await add_candidate(None)
    draft = await add_candidate(owner.tenant_id, status=StrategyStatus.DRAFT)
    async with await _session(owner) as s:
        with pytest.raises(Forbidden):
            await service.approve_canary(s, owner.ctx(role="member"), candidate.id, 10)
    async with await _session(owner) as s:
        with pytest.raises(Forbidden) as platform:
            await service.approve_canary(s, owner.ctx(), platform_candidate.id, 10)
        assert platform.value.code == "platform_admin_required"
    async with await _session(owner) as s:
        with pytest.raises(Conflict):
            await service.approve_canary(s, owner.ctx(), draft.id, 10)  # not evaluated: can never go live
    stranger = await acbe_user()
    async with await _session(stranger) as s:
        with pytest.raises(NotFound):
            await service.approve_canary(s, stranger.ctx(), candidate.id, 10)
    async with await _session(owner) as s:
        live = await service.approve_canary(s, owner.ctx(platform_admin=True), platform_candidate.id, 10)
        assert live.status == "canary"
    async with await _session(owner) as s:
        await service.rollback(s, owner.ctx(platform_admin=True), platform_candidate.id, "cleanup")


async def test_acbe_flag_blocks_rollout_but_never_rollback(acbe_user: Any) -> None:
    owner = await acbe_user()
    candidate = await add_candidate(owner.tenant_id)
    async with await _session(owner) as s:
        await service.approve_canary(s, owner.ctx(), candidate.id, 20)
    async with system_session() as s:
        s.add(FeatureFlag(key=Flags.ACBE, tenant_id=owner.tenant_id, enabled=False))
        await s.commit()
    clear_cache()
    try:
        async with await _session(owner) as s:
            with pytest.raises(FeatureDisabled):
                await service.promote(s, owner.ctx(), candidate.id, policy=NO_WAIT)
        async with await _session(owner) as s:
            assert (await service.rollback(s, owner.ctx(), candidate.id, "flag off")).status == "rolled_back"
    finally:
        clear_cache()


async def test_acbe_api(acbe_client: httpx.AsyncClient, acbe_user: Any) -> None:
    owner = await acbe_user()
    fingerprint = uuid.uuid4().hex
    for _ in range(3):
        await add_failed_task(owner, fingerprint=fingerprint)
    failures = await acbe_client.get("/api/v1/acbe/failures", headers=owner.headers)
    assert failures.status_code == 200, failures.text
    (pattern,) = [p for p in failures.json() if p["fingerprint"] == fingerprint]
    assert (pattern["failure_type"], pattern["tasks"], pattern["significant"]) == ("VERIFICATION_FAILURE", 3, True)

    passed = await add_candidate(owner.tenant_id)
    draft = await add_candidate(owner.tenant_id, status=StrategyStatus.DRAFT)
    listing = await acbe_client.get("/api/v1/acbe/candidates", headers=owner.headers)
    assert listing.status_code == 200 and {str(passed.id), str(draft.id)} <= {c["id"] for c in listing.json()["items"]}
    only_drafts = await acbe_client.get("/api/v1/acbe/candidates", params={"status": "draft"}, headers=owner.headers)
    assert {c["status"] for c in only_drafts.json()["items"]} == {"draft"}
    detail = await acbe_client.get(f"/api/v1/acbe/candidates/{passed.id}", headers=owner.headers)
    assert detail.status_code == 200 and detail.json()["experiments"] == []

    evaluate = await acbe_client.post(f"/api/v1/acbe/candidates/{draft.id}/evaluate", headers=owner.headers)
    assert evaluate.status_code == 202, evaluate.text
    async with system_session() as s:
        jobs = [j for j in (await s.execute(select(Job).where(Job.job_type == "acbe.run_experiment"))).scalars()
                if j.payload.get("candidate_id") == str(draft.id)]
    assert len(jobs) == 1 and jobs[0].queue == "evaluation"
    not_draft = await acbe_client.post(f"/api/v1/acbe/candidates/{passed.id}/evaluate", headers=owner.headers)
    assert not_draft.status_code == 409

    canary = await acbe_client.post(f"/api/v1/acbe/candidates/{passed.id}/canary", headers=owner.headers,
                                    json={"rollout_percentage": 25})
    assert canary.status_code == 200 and canary.json()["status"] == "canary", canary.text
    promote = await acbe_client.post(f"/api/v1/acbe/candidates/{passed.id}/promote", headers=owner.headers)
    assert promote.status_code == 409 and promote.json()["error"]["code"] == "canary_period_active"
    rollback = await acbe_client.post(f"/api/v1/acbe/candidates/{passed.id}/rollback", headers=owner.headers,
                                      json={"reason": "manual"})
    assert rollback.status_code == 200 and rollback.json()["status"] == "rolled_back"

    member = await acbe_user(role="member")
    assert (await acbe_client.get("/api/v1/acbe/candidates", headers=member.headers)).status_code == 403
    stranger = await acbe_user()
    assert (await acbe_client.get(f"/api/v1/acbe/candidates/{passed.id}", headers=stranger.headers)).status_code == 404
