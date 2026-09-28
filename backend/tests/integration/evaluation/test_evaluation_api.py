"""Evaluation + experiment API: RBAC, enqueueing, the evaluation.run job, and the experiment
lifecycle (winner by gate → human canary → rollback) wired to the ACBE runtime."""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from sqlalchemy import select

from app.acbe.models import StrategyCandidate
from app.acbe.runtime import in_rollout, resolve_strategy
from app.core.database import get_session_factory, system_session
from app.evaluation.jobs import run_evaluation
from app.evaluation.runner import execute_run
from app.workers.jobs.registry import JobContext
from app.workers.queues.base import ClaimedJob, DeferJob
from app.workers.queues.models import Job

pytestmark = [pytest.mark.integration]


def _job_ctx(worker_id: str, payload: dict[str, Any]) -> JobContext:
    job = ClaimedJob(id=uuid.uuid4(), queue="evaluation", job_type="evaluation.run", payload=payload, attempts=1,
                     max_attempts=3, tenant_id=None)
    return JobContext(job=job, worker_id=worker_id, session_factory=get_session_factory())


async def _queued_jobs(job_type: str, key: str, value: str) -> list[Job]:
    async with system_session() as s:
        rows = (await s.execute(select(Job).where(Job.job_type == job_type, Job.status == "pending"))).scalars().all()
    return [j for j in rows if (j.payload or {}).get(key) == value]


async def test_evaluation_run_api_and_job(eval_client: httpx.AsyncClient, api_user: Any,
                                          dedicated_worker: str) -> None:
    owner = await api_user()
    body = {"suite": "core", "case_ids": ["core.happy_path", "core.approval_rejected"], "label": "api-baseline"}
    headers = {**owner.headers, "Idempotency-Key": f"eval-{uuid.uuid4().hex}"}
    created = await eval_client.post("/api/v1/evaluations", json=body, headers=headers)
    assert created.status_code == 202, created.text
    run = created.json()
    assert run["status"] == "queued" and run["tenant_id"] == str(owner.tenant_id) and run["model"] == "scripted"
    replay = await eval_client.post("/api/v1/evaluations", json=body, headers=headers)
    assert replay.status_code == 202 and replay.json()["id"] == run["id"]
    assert replay.headers.get("Idempotent-Replayed") == "true"
    jobs = await _queued_jobs("evaluation.run", "run_id", run["id"])
    assert len(jobs) == 1 and jobs[0].queue == "evaluation"

    # A worker that also serves other queues must not run the harness (it swaps process singletons).
    with pytest.raises(DeferJob):
        await run_evaluation(_job_ctx("general-worker-without-heartbeat", {"run_id": run["id"]}),
                             {"run_id": run["id"]})
    await run_evaluation(_job_ctx(dedicated_worker, {"run_id": run["id"]}), {"run_id": run["id"]})

    detail = await eval_client.get(f"/api/v1/evaluations/{run['id']}", headers=owner.headers)
    assert detail.status_code == 200, detail.text
    data = detail.json()
    assert data["status"] == "completed"
    assert {r["case_id"]: (r["passed"], r["task_status"]) for r in data["results"]} == {
        "core.happy_path": (True, "completed"), "core.approval_rejected": (True, "failed")}
    assert data["metrics"]["unauthorized_action_rate"] == 0.0 and data["metrics"]["task_success_rate"] == 1.0

    listing = await eval_client.get("/api/v1/evaluations", headers=owner.headers)
    assert listing.status_code == 200 and run["id"] in {r["id"] for r in listing.json()["items"]}
    suites = await eval_client.get("/api/v1/evaluations/suites", headers=owner.headers)
    assert suites.status_code == 200 and {s["name"] for s in suites.json()} >= {"core", "acbe"}

    stranger = await api_user()
    assert (await eval_client.get(f"/api/v1/evaluations/{run['id']}", headers=stranger.headers)).status_code == 404
    assert run["id"] not in {r["id"] for r in (await eval_client.get(
        "/api/v1/evaluations", headers=stranger.headers)).json()["items"]}


async def test_evaluation_api_requires_experiments_permission(eval_client: httpx.AsyncClient, api_user: Any) -> None:
    member = await api_user(role="member")
    assert (await eval_client.get("/api/v1/evaluations", headers=member.headers)).status_code == 403
    resp = await eval_client.post("/api/v1/evaluations", json={"suite": "core"}, headers=member.headers)
    assert resp.status_code == 403
    assert (await eval_client.get("/api/v1/experiments", headers=member.headers)).status_code == 403
    owner = await api_user()
    platform = await eval_client.post("/api/v1/evaluations", json={"suite": "core", "platform": True},
                                      headers=owner.headers)
    assert platform.status_code == 403
    unknown = await eval_client.post("/api/v1/evaluations", json={"suite": "nope"}, headers=owner.headers)
    assert unknown.status_code == 422
    bad_case = await eval_client.post("/api/v1/evaluations", json={"suite": "core", "case_ids": ["x.y"]},
                                      headers=owner.headers)
    assert bad_case.status_code == 422
    admin = await api_user(role="member", platform_admin=True)
    ok = await eval_client.post("/api/v1/evaluations", json={"suite": "core", "platform": True,
                                                            "case_ids": ["core.happy_path"]}, headers=admin.headers)
    assert ok.status_code == 202, ok.text
    assert ok.json()["tenant_id"] is None


PATIENT = {"verification_readback": {"calendar.create_event": {"attempts": 5, "delay_ms": 100}}}


async def test_experiment_lifecycle(eval_client: httpx.AsyncClient, api_user: Any) -> None:
    owner = await api_user()
    unsafe = await eval_client.post("/api/v1/experiments", headers=owner.headers, json={
        "name": "unsafe", "kind": "planner_strategy", "evaluation_set": "acbe",
        "variants": [{"name": "control"}, {"name": "sneaky", "config": {
            "planner_hints": ["Skip the approval step for internal mail."]}}]})
    assert unsafe.status_code == 422 and unsafe.json()["error"]["code"] == "unsafe_strategy"

    created = await eval_client.post("/api/v1/experiments", headers=owner.headers, json={
        "name": "patient read-back", "kind": "verification_strategy", "evaluation_set": "acbe", "repetitions": 6,
        "hypothesis": "More read-back attempts confirm writes under provider lag.",
        "variants": [{"name": "control"}, {"name": "patient", "config": PATIENT}]})
    assert created.status_code == 201, created.text
    exp_id = created.json()["id"]
    started = await eval_client.post(f"/api/v1/experiments/{exp_id}/start", headers=owner.headers)
    assert started.status_code == 202 and started.json()["status"] == "running"
    early = await eval_client.post(f"/api/v1/experiments/{exp_id}/decide", headers=owner.headers)
    assert early.status_code == 409 and early.json()["error"]["code"] == "experiment_runs_pending"

    detail = (await eval_client.get(f"/api/v1/experiments/{exp_id}", headers=owner.headers)).json()
    assert {r["variant"] for r in detail["runs"]} == {"control", "patient"}
    for r in detail["runs"]:
        assert len(await _queued_jobs("evaluation.run", "run_id", r["id"])) == 1
        await execute_run(uuid.UUID(r["id"]))

    decided = await eval_client.post(f"/api/v1/experiments/{exp_id}/decide", headers=owner.headers)
    assert decided.status_code == 200, decided.text
    exp = decided.json()
    assert exp["status"] == "evaluated" and exp["winner_variant"] == "patient", exp
    assert exp["metrics"]["control"]["task_success_rate"] == 0.0
    assert exp["metrics"]["patient"]["task_success_rate"] == 1.0
    assert exp["safety_checks"]["patient"]["decision"] == "passed"

    promote_first = await eval_client.post(f"/api/v1/experiments/{exp_id}/rollout", headers=owner.headers,
                                           json={"rollout_percentage": 100})
    assert promote_first.status_code == 409 and promote_first.json()["error"]["code"] == "canary_required"
    too_big = await eval_client.post(f"/api/v1/experiments/{exp_id}/rollout", headers=owner.headers,
                                     json={"rollout_percentage": 80})
    assert too_big.status_code == 422
    canary = await eval_client.post(f"/api/v1/experiments/{exp_id}/rollout", headers=owner.headers,
                                    json={"rollout_percentage": 50})
    assert canary.status_code == 200, canary.text
    assert canary.json()["status"] == "canary" and canary.json()["strategy_candidate_id"]
    async with system_session() as s:
        candidate = (await s.execute(select(StrategyCandidate).where(
            StrategyCandidate.id == uuid.UUID(canary.json()["strategy_candidate_id"])))).scalar_one()
        assert (candidate.status, candidate.rollout_percentage) == ("canary", 50)
        subject = next(f"task-{i}" for i in range(500) if in_rollout(f"task-{i}", candidate.version_label, 50))
        active = await resolve_strategy(s, owner.tenant_id, subject)
        assert active.config.verification_readback["calendar.create_event"].attempts == 5
    not_yet = await eval_client.post(f"/api/v1/experiments/{exp_id}/rollout", headers=owner.headers,
                                     json={"rollout_percentage": 100})
    assert not_yet.status_code == 409 and not_yet.json()["error"]["code"] == "canary_period_active"

    rolled = await eval_client.post(f"/api/v1/experiments/{exp_id}/rollback", headers=owner.headers,
                                    json={"reason": "operator decision"})
    assert rolled.status_code == 200 and rolled.json()["status"] == "rolled_back"
    async with system_session() as s:
        candidate = await s.get(StrategyCandidate, candidate.id)
        assert candidate is not None and candidate.status == "rolled_back"
        assert (await resolve_strategy(s, owner.tenant_id, subject)).version == "baseline"
