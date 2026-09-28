"""Cross-tenant and cross-user isolation (spec §7): IDs from one tenant are useless in another."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.database import get_session_factory
from app.core.exceptions import TenantScopeError
from app.integrations.models import OAuthConnection
from app.tasks.models import Task
from tests.e2e.test_acceptance_scenario import scenario_plan
from tests.fakes.harness import Harness

pytestmark = [pytest.mark.security, pytest.mark.integration]


@pytest.fixture
async def harness():
    h = Harness()
    yield h
    await h.close()


async def test_user_cannot_access_another_tenants_task_or_approval(client, make_user, harness):
    alice, bob = await make_user(), await make_user()
    await harness.connect_google(alice.tenant_id, alice.user_id)
    harness.google.add_contact("Rahim", "rahim@example.org")
    harness.plans["default"] = scenario_plan()
    task_id = (await client.post("/api/v1/tasks", json={"goal": "meet Rahim"}, headers=alice.headers)).json()["task_id"]
    await harness.run_jobs()
    approval = (await client.get("/api/v1/approvals", params={"task_id": task_id},
                                 headers=alice.headers)).json()["items"][0]

    for path in (f"/api/v1/tasks/{task_id}", f"/api/v1/tasks/{task_id}/events", f"/api/v1/tasks/{task_id}/summary",
                 f"/api/v1/approvals/{approval['id']}"):
        assert (await client.get(path, headers=bob.headers)).status_code == 404, path
    for path in (f"/api/v1/tasks/{task_id}/cancel", f"/api/v1/approvals/{approval['id']}/approve"):
        assert (await client.post(path, headers=bob.headers)).status_code == 404, path
    reject = await client.post(f"/api/v1/approvals/{approval['id']}/reject", json={"reason": "x"}, headers=bob.headers)
    assert reject.status_code == 404
    listing = (await client.get("/api/v1/tasks", params={"all_users": True}, headers=bob.headers)).json()
    assert all(t["task_id"] != task_id for t in listing["items"])
    assert (await client.get("/api/v1/approvals", headers=bob.headers)).json()["items"] == []
    # Alice's task is untouched.
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=alice.headers)).json()["status"] == "waiting_approval"


async def test_member_of_same_org_cannot_approve_others_actions_without_decide_any(client, make_user, harness):
    owner = await make_user()
    member = await make_user()
    added = await client.post("/api/v1/organizations/current/members", json={"email": member.email, "role": "member"},
                              headers=owner.headers)
    assert added.status_code == 201, added.text
    switched = await client.post("/api/v1/auth/switch-organization",
                                 json={"organization_id": str(owner.tenant_id)}, headers=member.headers)
    assert switched.status_code == 200
    member_headers = {"Authorization": f"Bearer {switched.json()['access_token']}"}
    await harness.connect_google(owner.tenant_id, owner.user_id)
    harness.google.add_contact("Rahim", "rahim@example.org")
    harness.plans["default"] = scenario_plan()
    task_id = (await client.post("/api/v1/tasks", json={"goal": "meet"}, headers=owner.headers)).json()["task_id"]
    await harness.run_jobs()
    approval = (await client.get("/api/v1/approvals", params={"task_id": task_id},
                                 headers=owner.headers)).json()["items"][0]
    assert (await client.post(f"/api/v1/approvals/{approval['id']}/approve",
                              headers=member_headers)).status_code == 404
    assert (await client.get(f"/api/v1/tasks/{task_id}", headers=member_headers)).status_code == 404


async def test_tool_credentials_do_not_leak_across_tenants(client, make_user, harness):
    """Bob's task can never use Alice's Google connection: the vault resolves by the
    task owner's tenant + user, so Bob is simply 'not connected'."""
    alice, bob = await make_user(), await make_user()
    await harness.connect_google(alice.tenant_id, alice.user_id)
    harness.plans["default"] = scenario_plan()
    task_id = (await client.post("/api/v1/tasks", json={"goal": "meet"}, headers=bob.headers)).json()["task_id"]
    await harness.run_jobs()
    task = (await client.get(f"/api/v1/tasks/{task_id}", headers=bob.headers)).json()
    assert task["status"] in ("blocked", "waiting_input")
    find_slot = next(s for s in task["steps"] if s["step_key"] == "find_slot")
    assert find_slot["status"] == "blocked" and find_slot["error_class"] == "auth_expired"
    assert harness.google.calendar_events == {}
    with pytest.raises(Exception):  # noqa: B017 - any denial is acceptable, but it must not return a token
        await harness.services.vault.get_google_access(bob.tenant_id, alice.user_id, [])


async def test_orm_guard_scopes_queries_and_blocks_unscoped_access(make_user):
    alice, bob = await make_user(), await make_user()
    sf = get_session_factory()
    async with sf() as s:
        s.info["tenant_id"] = alice.tenant_id
        s.add(Task(tenant_id=alice.tenant_id, user_id=alice.user_id, goal="alice task", budget={}))
        await s.commit()
    async with sf() as s:
        s.info["tenant_id"] = bob.tenant_id
        rows = (await s.execute(select(Task).where(Task.goal == "alice task"))).scalars().all()
        assert rows == [], "tenant guard must filter other tenants' rows even without a WHERE clause"
        s.add(Task(tenant_id=alice.tenant_id, user_id=alice.user_id, goal="smuggled", budget={}))
        with pytest.raises(TenantScopeError):
            await s.flush()
    async with sf() as s:  # neither tenant nor system scope
        with pytest.raises(TenantScopeError):
            await s.execute(select(OAuthConnection))


async def test_request_context_ignores_client_supplied_tenant(client, make_user):
    alice, bob = await make_user(), await make_user()
    resp = await client.post("/api/v1/tasks", json={"goal": "x", "tenant_id": str(bob.tenant_id)},
                             headers=alice.headers)
    assert resp.status_code == 422  # unknown fields are rejected, never used for authorization
    switched = await client.post("/api/v1/auth/switch-organization", json={"organization_id": str(bob.tenant_id)},
                                 headers=alice.headers)
    assert switched.status_code == 403
    assert uuid.UUID(str(alice.tenant_id)) != bob.tenant_id
