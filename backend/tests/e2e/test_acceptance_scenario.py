"""Critical acceptance scenario (spec §112), end to end through the real API, planner,
validator, permission engine, approvals, execution engine, Google adapters, verification
and audit — against the simulated Google Workspace.

"Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting
with Rahim, and send him a confirmation email."
"""

from __future__ import annotations

import uuid
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.audit.models import AuditLog
from app.core.database import get_session_factory
from app.tasks.models import ExternalAction, TaskEvent
from app.usage.models import UsageEvent
from tests.fakes.harness import Harness

pytestmark = [pytest.mark.e2e, pytest.mark.integration]

GOAL = ("Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with Rahim, "
        "and send him a confirmation email.")
TZ = "Asia/Dhaka"


def scenario_plan() -> dict:
    return {
        "goal": GOAL,
        "summary": "Find a free 30-minute slot tomorrow after 2 PM, invite Rahim, then e-mail him a confirmation.",
        "steps": [
            {"step_id": "find_slot", "action": "Find a free 30-minute slot tomorrow after 2 PM",
             "tool": "calendar.find_free_slots",
             "arguments": {"date": "tomorrow", "duration_minutes": 30, "earliest_time": "14:00",
                           "latest_time": "18:00"},
             "dependencies": [], "risk_level": "low", "requires_approval": False},
            {"step_id": "find_rahim", "action": "Look up Rahim's e-mail address", "tool": "contacts.lookup",
             "arguments": {"name": "Rahim"}, "dependencies": [], "risk_level": "low", "requires_approval": False},
            {"step_id": "create_meeting", "action": "Schedule the meeting with Rahim", "tool": "calendar.create_event",
             "arguments": {"summary": "Meeting with Rahim",
                           "start": {"$ref": "steps.find_slot.output.slots.0.start"},
                           "end": {"$ref": "steps.find_slot.output.slots.0.end"},
                           "attendees": [{"$ref": "steps.find_rahim.output.best.email"}]},
             "dependencies": ["find_slot", "find_rahim"], "risk_level": "medium", "requires_approval": True,
             "verification_method": "read_back"},
            {"step_id": "send_confirmation", "action": "E-mail Rahim a confirmation", "tool": "gmail.send",
             "arguments": {"to": [{"$ref": "steps.find_rahim.output.best.email"}],
                           "subject": "Meeting confirmation",
                           "body": "Hi Rahim,\n\nOur meeting is confirmed for "
                                   "{{steps.create_meeting.output.start}}.\n\nBest regards"},
             "dependencies": ["create_meeting", "find_rahim"], "risk_level": "high", "requires_approval": True},
        ],
    }


def tomorrow_at(hour: int, minute: int = 0) -> datetime:
    tz = ZoneInfo(TZ)
    day = datetime.now(tz).date() + timedelta(days=1)
    return datetime.combine(day, time(hour, minute), tz)


@pytest_asyncio.fixture
async def harness():
    h = Harness()
    yield h
    await h.close()


async def _setup(client, make_user, harness, *, contact_email: str = "rahim@example.org"):
    user = await make_user(timezone=TZ)
    await harness.connect_google(user.tenant_id, user.user_id)
    harness.google.add_contact("Rahim Uddin", contact_email)
    harness.google.add_busy(tomorrow_at(14), tomorrow_at(15))  # 14:00-15:00 busy → first slot 15:00
    harness.plans["default"] = scenario_plan()
    return user


async def _task(client, user, task_id):
    resp = await client.get(f"/api/v1/tasks/{task_id}", headers=user.headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _pending_approvals(client, user, task_id):
    resp = await client.get("/api/v1/approvals", params={"status": "pending", "task_id": task_id},
                            headers=user.headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["items"]


async def test_full_acceptance_scenario(client, make_user, harness):
    user = await _setup(client, make_user, harness)
    idem = f"accept-{uuid.uuid4().hex}"
    created = await client.post("/api/v1/tasks", json={"goal": GOAL},
                                headers={**user.headers, "Idempotency-Key": idem})
    assert created.status_code == 202, created.text
    task_id = created.json()["task_id"]

    # Duplicate submission returns the same logical operation.
    dup = await client.post("/api/v1/tasks", json={"goal": GOAL}, headers={**user.headers, "Idempotency-Key": idem})
    assert dup.status_code == 202 and dup.json()["task_id"] == task_id
    assert dup.headers.get("Idempotent-Replayed") == "true"

    await harness.run_jobs()
    task = await _task(client, user, task_id)
    assert task["status"] == "waiting_approval", task
    steps = {s["step_key"]: s for s in task["steps"]}
    assert steps["find_slot"]["status"] == "completed"
    assert steps["find_slot"]["verification_status"] == "passed"
    assert steps["find_rahim"]["status"] == "completed"
    assert steps["create_meeting"]["status"] == "waiting_approval"
    assert steps["send_confirmation"]["status"] == "pending"
    assert harness.google.calendar_events == {}, "nothing may be written before approval"

    approvals = await _pending_approvals(client, user, task_id)
    assert len(approvals) == 1
    approval = approvals[0]
    assert approval["tool_name"] == "calendar.create_event"
    assert approval["arguments_preview"]["attendees"] == ["rahim@example.org"]
    assert approval["risk_level"] == "high"  # external attendee
    expected_start = tomorrow_at(15)
    assert datetime.fromisoformat(approval["arguments_preview"]["start"]) == expected_start

    ok = await client.post(f"/api/v1/approvals/{approval['id']}/approve", headers=user.headers)
    assert ok.status_code == 200, ok.text
    # Replaying the approval is rejected.
    again = await client.post(f"/api/v1/approvals/{approval['id']}/approve", headers=user.headers)
    assert again.status_code == 409

    await harness.run_jobs()
    task = await _task(client, user, task_id)
    assert task["status"] == "waiting_approval", task
    assert len(harness.google.calendar_events) == 1
    event = next(iter(harness.google.calendar_events.values()))
    assert event["attendees"][0]["email"] == "rahim@example.org"
    assert datetime.fromisoformat(event["start"]["dateTime"]) == expected_start
    steps = {s["step_key"]: s for s in task["steps"]}
    assert steps["create_meeting"]["status"] == "completed"
    assert steps["create_meeting"]["verification_status"] == "passed"
    assert steps["create_meeting"]["external_ref"] == event["id"]

    email_approval = (await _pending_approvals(client, user, task_id))[0]
    assert email_approval["tool_name"] == "gmail.send"
    assert email_approval["arguments_preview"]["to"] == ["rahim@example.org"]
    assert "Our meeting is confirmed for" in email_approval["arguments_preview"]["body"]
    assert (await client.post(f"/api/v1/approvals/{email_approval['id']}/approve",
                              headers=user.headers)).status_code == 200
    await harness.run_jobs()

    task = await _task(client, user, task_id)
    assert task["status"] == "completed", task
    assert task["progress"] == 1.0
    sent = [m for m in harness.google.messages.values() if "SENT" in m["labelIds"]]
    assert len(sent) == 1
    steps = {s["step_key"]: s for s in task["steps"]}
    assert all(s["verification_status"] == "passed" for s in steps.values())
    summary = task["result_summary"]
    assert summary["status"] == "completed"
    assert {c["tool"] for c in summary["what_changed"]} == {"calendar.create_event", "gmail.send"}
    assert all(v["status"] == "passed" for v in summary["what_was_verified"])
    task_level = [v for v in task["verifications"] if v["scope"] == "task"]
    assert task_level and task_level[-1]["status"] == "passed"
    repro = task["reproducibility"]
    assert repro["tool_versions"]["create_meeting"] == "calendar.create_event:v1"
    assert repro["policy_version"] is not None

    async with get_session_factory()() as s:
        s.info["tenant_id"] = user.tenant_id
        events = [e.event_type for e in (await s.execute(
            select(TaskEvent).where(TaskEvent.task_id == uuid.UUID(task_id)).order_by(TaskEvent.seq))).scalars()]
        seqs = [e.seq for e in (await s.execute(
            select(TaskEvent).where(TaskEvent.task_id == uuid.UUID(task_id)).order_by(TaskEvent.seq))).scalars()]
        assert seqs == list(range(1, len(seqs) + 1)), "event sequence must be gap-free"
        for expected in ("TASK_CREATED", "PLAN_CREATED", "PLAN_VALIDATED", "APPROVAL_REQUIRED", "APPROVAL_GRANTED",
                         "TOOL_CALL_STARTED", "VERIFICATION_PASSED", "TASK_COMPLETED"):
            assert expected in events, expected
        ledger = (await s.execute(select(ExternalAction).where(
            ExternalAction.task_id == uuid.UUID(task_id)))).scalars().all()
        assert {row.status for row in ledger} == {"succeeded"} and len(ledger) == 2
        actions = {a.action for a in (await s.execute(select(AuditLog).where(
            AuditLog.task_id == uuid.UUID(task_id)))).scalars()}
        assert {"task.create", "approval.requested", "approval.approved", "tool.executed",
                "task.completed"} <= actions
        usage = (await s.execute(select(UsageEvent).where(UsageEvent.task_id == uuid.UUID(task_id)))).scalars().all()
        assert sum(1 for u in usage if u.kind == "tool_call") == 4

    summary_resp = await client.get(f"/api/v1/tasks/{task_id}/summary", headers=user.headers)
    assert summary_resp.status_code == 200
    assert summary_resp.json()["headline"].startswith("Done")
