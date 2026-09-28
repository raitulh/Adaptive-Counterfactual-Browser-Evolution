from __future__ import annotations

import asyncio

import pytest

from tests.e2e.test_acceptance_scenario import scenario_plan
from tests.fakes.harness import Harness

pytestmark = pytest.mark.integration


@pytest.fixture
async def harness():
    h = Harness()
    yield h
    await h.close()


async def test_health_endpoints(client):
    assert (await client.get("/api/v1/live")).json() == {"status": "alive"}
    health = (await client.get("/api/v1/health")).json()
    assert health["checks"]["database"]["status"] == "ok" and health["checks"]["redis"]["status"] == "ok"
    ready = await client.get("/api/v1/ready")
    assert ready.status_code in (200, 503)  # 503 until migrations are applied (create_all mode)


async def test_agents_are_versioned(client, make_user):
    user = await make_user()
    created = await client.post("/api/v1/agents", json={"name": "scheduler", "instructions": "Be brief.",
                                                         "tool_policy": {"allowed": ["calendar.*"]}},
                                headers=user.headers)
    assert created.status_code == 201, created.text
    agent = created.json()
    assert agent["current_version"]["version_number"] == 1
    v2 = await client.post(f"/api/v1/agents/{agent['id']}/versions", json={"instructions": "Be very brief."},
                           headers=user.headers)
    assert v2.status_code == 201 and v2.json()["version_number"] == 2
    versions = (await client.get(f"/api/v1/agents/{agent['id']}/versions", headers=user.headers)).json()
    assert [v["version_number"] for v in versions] == [2, 1]
    assert versions[0]["checksum"] != versions[1]["checksum"]


async def test_agent_tool_policy_restricts_plans(client, make_user, harness):
    user = await make_user()
    agent = (await client.post("/api/v1/agents", json={"name": "readonly", "tool_policy": {"allowed": ["calendar.list_events"]}},
                               headers=user.headers)).json()
    harness.plans["default"] = scenario_plan()
    task = (await client.post("/api/v1/tasks", json={"goal": "meet", "agent_id": agent["id"]},
                              headers=user.headers)).json()
    await harness.run_jobs()
    detail = (await client.get(f"/api/v1/tasks/{task['task_id']}", headers=user.headers)).json()
    assert detail["status"] == "blocked" and detail["failure_code"] == "policy_denied"
    assert detail["reproducibility"]["agent"]["agent_version_id"] == agent["current_version_id"]


async def test_tool_catalogue_and_policies(client, make_user):
    user = await make_user()
    tools = (await client.get("/api/v1/tools", headers=user.headers)).json()
    send = next(t for t in tools if t["name"] == "gmail.send")
    assert send["requires_approval"] and send["available_to_you"]
    rule = await client.post("/api/v1/tools/policies", json={"tool_pattern": "gmail.*", "effect": "deny"},
                             headers=user.headers)
    assert rule.status_code == 201
    tools = (await client.get("/api/v1/tools", headers=user.headers)).json()
    assert not next(t for t in tools if t["name"] == "gmail.send")["available_to_you"]
    blanket = await client.post("/api/v1/tools/policies", json={"tool_pattern": "*", "effect": "allow"},
                                headers=user.headers)
    assert blanket.status_code == 422


async def test_rbac_viewer_cannot_create_tasks(client, make_user):
    owner, viewer = await make_user(), await make_user()
    assert (await client.post("/api/v1/organizations/current/members", json={"email": viewer.email, "role": "viewer"},
                              headers=owner.headers)).status_code == 201
    token = (await client.post("/api/v1/auth/switch-organization", json={"organization_id": str(owner.tenant_id)},
                               headers=viewer.headers)).json()["access_token"]
    resp = await client.post("/api/v1/tasks", json={"goal": "x"}, headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
    policy = await client.put("/api/v1/organizations/current/policy", json={"blocked_tools": ["*"]},
                              headers={"Authorization": f"Bearer {token}"})
    assert policy.status_code == 403


async def test_admin_api_requires_platform_admin(client, make_user, db_session):
    user = await make_user()
    assert (await client.get("/api/v1/admin/system", headers=user.headers)).status_code == 403
    from app.users.models import User

    row = await db_session.get(User, user.user_id)
    row.is_platform_admin = True
    await db_session.commit()
    system = await client.get("/api/v1/admin/system", headers=user.headers)
    assert system.status_code == 200 and "queues" in system.json()


async def test_sse_stream_replays_events_and_ends(client, make_user, harness):
    user = await make_user()
    harness.plans["default"] = {"goal": "2+2", "steps": [], "direct_response": "4"}
    task_id = (await client.post("/api/v1/tasks", json={"goal": "what is 2+2"}, headers=user.headers)).json()["task_id"]
    await harness.run_jobs()
    detail = (await client.get(f"/api/v1/tasks/{task_id}", headers=user.headers)).json()
    assert detail["status"] == "completed"
    assert detail["result_summary"]["direct_response"] == "4"
    token = (await client.post("/api/v1/auth/stream-token", headers=user.headers)).json()["token"]

    async def read_stream() -> str:
        chunks = []
        async with client.stream("GET", f"/api/v1/tasks/{task_id}/events/stream",
                                 params={"access_token": token}, headers={"Last-Event-ID": "1"}) as resp:
            assert resp.status_code == 200
            async for chunk in resp.aiter_text():
                chunks.append(chunk)
                if "event: end" in "".join(chunks):
                    break
        return "".join(chunks)

    body = await asyncio.wait_for(read_stream(), timeout=10)
    assert "id: 1\n" not in body and "id: 2\n" in body  # resumed after Last-Event-ID
    assert "event: TASK_COMPLETED" in body and "event: end" in body


async def test_usage_and_notifications_endpoints(client, make_user, harness):
    user = await make_user()
    harness.plans["default"] = {"goal": "2+2", "steps": [], "direct_response": "4"}
    await client.post("/api/v1/tasks", json={"goal": "what is 2+2"}, headers=user.headers)
    await harness.run_jobs()
    usage = (await client.get("/api/v1/usage", headers=user.headers)).json()
    assert usage["totals"]["task_created"] >= 1 and usage["plan"] == "free"
    notes = (await client.get("/api/v1/notifications", headers=user.headers)).json()["items"]
    assert any(n["event_type"] == "task_completed" for n in notes)
    assert (await client.post("/api/v1/notifications/read-all", headers=user.headers)).status_code == 204
    audit = await client.get("/api/v1/audit", headers=user.headers)
    assert audit.status_code == 200 and audit.json()["items"]
