"""Automations HTTP API: validation, limits, ownership, idempotency, run-now."""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from sqlalchemy import select

from app.audit.models import AuditLog
from app.automations.models import AutomationRun
from app.core.config import get_settings
from app.tasks.models import Task

pytestmark = pytest.mark.integration

BASE = "/api/v1/automations"


def _body(**overrides):
    body = {"name": "Morning digest", "cron_expression": "0 8 * * 1-5", "timezone": "Europe/Berlin",
            "task_template": {"goal": "Summarize my unread e-mails"}}
    body.update(overrides)
    return body


async def _audit_actions(sf, resource_id: str) -> list[str]:
    async with sf() as s:
        s.info["system"] = True
        return list((await s.execute(select(AuditLog.action).where(AuditLog.resource_id == resource_id)
                                     )).scalars().all())


async def test_create_get_list_and_audit(api, register_user, sf):
    user = await register_user()
    resp = await api.post(BASE, json=_body(), headers=user.headers)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["enabled"] is True and created["run_count"] == 0
    assert created["policy"] == {"pause_on_failure": True, "max_consecutive_failures": 3}
    assert created["retry_policy"]["max_attempts"] <= 5
    assert datetime.fromisoformat(created["next_run_at"]).utcoffset() is not None

    got = await api.get(f"{BASE}/{created['id']}", headers=user.headers)
    assert got.status_code == 200 and got.json()["id"] == created["id"]
    listed = await api.get(BASE, headers=user.headers)
    assert listed.status_code == 200 and [a["id"] for a in listed.json()["items"]] == [created["id"]]
    assert "automation.create" in await _audit_actions(sf, created["id"])


@pytest.mark.parametrize(("field", "value"), [("cron_expression", "*/5 * * * *"), ("timezone", "Mars/Base"),
                                              ("cron_expression", "not cron"), ("task_template", {"goal": ""})])
async def test_create_rejects_invalid_schedule(api, register_user, field, value):
    user = await register_user()
    resp = await api.post(BASE, json=_body(**{field: value}), headers=user.headers)
    assert resp.status_code == 422, resp.text
    assert resp.json()["error"]["code"] == "validation_failed"


async def test_plan_limits_number_of_automations(api, register_user):
    user = await register_user()  # free plan: 3 automations
    for i in range(3):
        assert (await api.post(BASE, json=_body(name=f"a{i}"), headers=user.headers)).status_code == 201
    resp = await api.post(BASE, json=_body(name="one too many"), headers=user.headers)
    assert resp.status_code == 429 and resp.json()["error"]["code"] == "automation_limit_reached"


async def test_create_is_rate_limited_per_user(api, register_user, set_plan, monkeypatch):
    user = await register_user()
    await set_plan(user.tenant_id, "team")
    monkeypatch.setattr(get_settings(), "rate_limit_automation_create_per_hour", 2)
    for i in range(2):
        assert (await api.post(BASE, json=_body(name=f"r{i}"), headers=user.headers)).status_code == 201
    resp = await api.post(BASE, json=_body(name="r3"), headers=user.headers)
    assert resp.status_code == 429 and resp.json()["error"]["code"] == "rate_limited"


async def test_idempotency_key_replays_the_original_response(api, register_user):
    user = await register_user()
    headers = {**user.headers, "Idempotency-Key": f"create-{uuid.uuid4().hex}"}
    first = await api.post(BASE, json=_body(), headers=headers)
    second = await api.post(BASE, json=_body(), headers=headers)
    assert first.status_code == second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    assert second.headers.get("Idempotent-Replayed") == "true"
    assert len((await api.get(BASE, headers=user.headers)).json()["items"]) == 1
    reused = await api.post(BASE, json=_body(name="different"), headers=headers)
    assert reused.status_code == 422 and reused.json()["error"]["code"] == "idempotency_key_reused"


async def test_automations_are_private_to_their_owner(api, register_user, add_member):
    owner = await register_user()
    colleague = await register_user()
    await add_member(owner.tenant_id, colleague.user_id)
    created = (await api.post(BASE, json=_body(), headers=owner.headers)).json()
    stranger = await register_user()
    for other in (colleague, stranger):
        assert (await api.get(f"{BASE}/{created['id']}", headers=other.headers)).status_code == 404
        assert (await api.patch(f"{BASE}/{created['id']}", json={"enabled": False},
                                headers=other.headers)).status_code == 404
        assert (await api.post(f"{BASE}/{created['id']}/run-now", headers=other.headers)).status_code == 404
        assert (await api.get(f"{BASE}/{created['id']}/runs", headers=other.headers)).status_code == 404
        assert (await api.delete(f"{BASE}/{created['id']}", headers=other.headers)).status_code == 404
    assert (await api.get(BASE, headers=stranger.headers)).json()["items"] == []


async def test_viewer_role_cannot_manage_automations(api, register_user, sf):
    from app.automations import service
    from app.automations.schemas import AutomationCreate
    from app.common.context import RequestContext
    from app.core.exceptions import Forbidden
    from app.organizations.rbac import ROLE_PERMISSIONS

    user = await register_user()
    created = (await api.post(BASE, json=_body(), headers=user.headers)).json()
    viewer = RequestContext(user_id=user.user_id, tenant_id=user.tenant_id, role="viewer",
                            permissions=frozenset(ROLE_PERMISSIONS["viewer"]))
    async with sf() as s:
        s.info["tenant_id"] = user.tenant_id
        with pytest.raises(Forbidden):
            await service.create_automation(s, viewer, AutomationCreate.model_validate(_body()))
        with pytest.raises(Forbidden):
            await service.run_now(s, viewer, uuid.UUID(created["id"]))
        with pytest.raises(Forbidden):
            await service.delete_automation(s, viewer, uuid.UUID(created["id"]))


async def test_update_disable_reenable_and_version_conflict(api, register_user, sf):
    user = await register_user()
    created = (await api.post(BASE, json=_body(), headers=user.headers)).json()
    url = f"{BASE}/{created['id']}"

    disabled = await api.patch(url, json={"enabled": False}, headers=user.headers)
    assert disabled.status_code == 200 and disabled.json()["enabled"] is False
    assert disabled.json()["next_run_at"] is None

    stale = await api.patch(url, json={"name": "x", "expected_version": created["version"]}, headers=user.headers)
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "version_conflict"

    enabled = await api.patch(url, json={"enabled": True, "cron_expression": "30 7 * * *", "timezone": "UTC",
                                         "expected_version": disabled.json()["version"]}, headers=user.headers)
    assert enabled.status_code == 200, enabled.text
    data = enabled.json()
    assert data["enabled"] is True and data["cron_expression"] == "30 7 * * *"
    next_run = datetime.fromisoformat(data["next_run_at"])
    assert (next_run.hour, next_run.minute) == (7, 30)

    bad = await api.patch(url, json={"cron_expression": "* * * * *"}, headers=user.headers)
    assert bad.status_code == 422
    null = await api.patch(url, json={"name": None}, headers=user.headers)
    assert null.status_code == 422
    assert "automation.update" in await _audit_actions(sf, created["id"])


async def test_delete_is_soft_and_hides_the_automation(api, register_user, sf):
    user = await register_user()
    created = (await api.post(BASE, json=_body(), headers=user.headers)).json()
    resp = await api.delete(f"{BASE}/{created['id']}", headers=user.headers)
    assert resp.status_code == 204
    assert (await api.get(f"{BASE}/{created['id']}", headers=user.headers)).status_code == 404
    assert (await api.get(BASE, headers=user.headers)).json()["items"] == []
    from app.automations.models import Automation

    async with sf() as s:
        s.info["system"] = True
        row = await s.get(Automation, uuid.UUID(created["id"]))
    assert row is not None and row.deleted_at is not None and row.enabled is False and row.next_run_at is None
    assert "automation.delete" in await _audit_actions(sf, created["id"])


async def test_run_now_is_idempotent_per_minute(api, register_user, sf):
    user = await register_user()
    created = (await api.post(BASE, json=_body(enabled=False), headers=user.headers)).json()
    first = await api.post(f"{BASE}/{created['id']}/run-now", headers=user.headers)
    assert first.status_code == 202, first.text
    run = first.json()
    assert run["trigger"] == "manual" and run["status"] == "created" and run["task_id"]
    second = await api.post(f"{BASE}/{created['id']}/run-now", headers=user.headers)
    if second.headers.get("Idempotent-Replayed") == "true":
        assert second.json()["id"] == run["id"]
    else:  # the minute rolled over between the two calls
        assert second.json()["id"] != run["id"]

    async with sf() as s:
        s.info["system"] = True
        task = await s.get(Task, uuid.UUID(run["task_id"]))
        runs = (await s.execute(select(AutomationRun).where(
            AutomationRun.automation_id == uuid.UUID(created["id"])))).scalars().all()
    assert task is not None and task.source == "automation" and task.automation_run_id == uuid.UUID(run["id"])
    assert len(runs) in (1, 2)

    listed = await api.get(f"{BASE}/{created['id']}/runs", headers=user.headers)
    assert listed.status_code == 200 and run["id"] in [r["id"] for r in listed.json()["items"]]
    assert "automation.run_now" in await _audit_actions(sf, created["id"])


async def test_list_pagination(api, register_user, set_plan):
    user = await register_user()
    await set_plan(user.tenant_id, "pro")
    ids = [(await api.post(BASE, json=_body(name=f"p{i}"), headers=user.headers)).json()["id"] for i in range(5)]
    page1 = (await api.get(BASE, params={"limit": 2}, headers=user.headers)).json()
    assert page1["has_more"] is True and len(page1["items"]) == 2
    seen = [a["id"] for a in page1["items"]]
    cursor = page1["next_cursor"]
    while cursor:
        page = (await api.get(BASE, params={"limit": 2, "cursor": cursor}, headers=user.headers)).json()
        seen += [a["id"] for a in page["items"]]
        cursor = page["next_cursor"]
    assert sorted(seen) == sorted(ids) and len(seen) == len(set(seen))
