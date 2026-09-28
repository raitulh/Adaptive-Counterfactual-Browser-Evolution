from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from app.agents.service import builtin_default
from app.common.context import RequestContext
from app.organizations.rbac import ROLE_PERMISSIONS
from app.organizations.schemas import OrganizationPolicy
from app.permissions.service import PolicyInputs
from app.planner.schemas import Plan
from app.planner.validator import PlanValidator, topological_order, validate_literal_arguments
from app.tools.builtin.google_calendar import compute_free_slots, event_id_for, resolve_date
from app.tools.registry import get_tool_registry


def _ctx() -> RequestContext:
    return RequestContext(user_id=uuid.uuid4(), tenant_id=uuid.uuid4(), role="member",
                          permissions=frozenset(ROLE_PERMISSIONS["member"]))


def _policy() -> PolicyInputs:
    agent = builtin_default()
    return PolicyInputs(org_policy=OrganizationPolicy(), policy_version=1, tool_rules=[],
                        agent_tool_policy=agent.tool_policy, flags={})


async def _validate(plan: dict[str, Any]):
    return await PlanValidator().validate(None, _ctx(), Plan.model_validate(plan), agent=builtin_default(),  # type: ignore[arg-type]
                                          policy=_policy(), remaining_tool_calls=50)


async def test_valid_plan_and_approval_classification() -> None:
    from tests.e2e.test_acceptance_scenario import scenario_plan

    result = await _validate(scenario_plan())
    assert result.ok, result.issues
    decisions = {v.step.step_id: v.decision.decision.value for v in result.steps}
    assert decisions["find_slot"] == "allow"
    assert decisions["send_confirmation"] == "require_approval"
    assert [v.step.step_id for v in result.steps][:2] == ["find_slot", "find_rahim"]


async def test_cycles_unknown_tools_and_bad_refs_are_rejected() -> None:
    plan = {"goal": "g", "steps": [
        {"step_id": "a", "action": "a", "tool": "calendar.list_events", "arguments": {"date": "today"},
         "dependencies": ["b"]},
        {"step_id": "b", "action": "b", "tool": "calendar.list_events", "arguments": {"date": "today"},
         "dependencies": ["a"]},
        {"step_id": "c", "action": "c", "tool": "os.exec", "arguments": {}, "dependencies": []},
        {"step_id": "d", "action": "d", "tool": "gmail.send",
         "arguments": {"to": [{"$ref": "steps.a.output.events.0.organizer"}], "subject": "x", "body": "y"},
         "dependencies": []},
    ]}
    result = await _validate(plan)
    codes = {i.code for i in result.issues}
    assert {"dependency_cycle", "unknown_tool", "reference_not_dependency"} <= codes


async def test_limits_and_empty_plans() -> None:
    step = {"step_id": "s", "action": "a", "tool": "calendar.list_events", "arguments": {"date": "today"}}
    many = {"goal": "g", "steps": [{**step, "step_id": f"s{i}"} for i in range(25)]}
    assert "too_many_steps" in {i.code for i in (await _validate(many)).issues}
    assert "empty_plan" in {i.code for i in (await _validate({"goal": "g", "steps": []})).issues}
    direct = await _validate({"goal": "what is 2+2", "steps": [], "direct_response": "4"})
    assert direct.ok


def test_literal_argument_validation() -> None:
    tool = get_tool_registry().get("calendar.find_free_slots")
    assert validate_literal_arguments(tool, {"date": "tomorrow", "duration_minutes": 30}) == []
    problems = validate_literal_arguments(tool, {"date": "tomorrow", "duration_minutes": 9999, "bogus": 1})
    assert any("duration_minutes" in p for p in problems) and any("bogus" in p for p in problems)
    assert any("missing required" in p for p in validate_literal_arguments(tool, {"date": "tomorrow"}))


def test_topological_order() -> None:
    from app.planner.schemas import PlanStep

    steps = [PlanStep(step_id=i, action=i, tool="calendar.list_events", dependencies=d)
             for i, d in (("c", ["a", "b"]), ("a", []), ("b", ["a"]))]
    order, cyclic = topological_order(steps)
    assert order == ["a", "b", "c"] and cyclic == []


def test_free_slot_computation() -> None:
    tz = ZoneInfo("Asia/Dhaka")
    day = datetime(2026, 9, 29, tzinfo=tz)
    start, end = day.replace(hour=14), day.replace(hour=18)
    busy = [(day.replace(hour=14), day.replace(hour=15)), (day.replace(hour=15, minute=30), day.replace(hour=16))]
    slots = compute_free_slots(start, end, busy, timedelta(minutes=30), timedelta(minutes=15), 5)
    assert slots[0] == (day.replace(hour=15), day.replace(hour=15, minute=30))
    assert slots[1] == (day.replace(hour=16), day.replace(hour=16, minute=30))
    assert all(s >= start and e <= end for s, e in slots)
    assert compute_free_slots(start, end, [(start, end)], timedelta(minutes=30), timedelta(minutes=15), 5) == []


def test_relative_dates_and_event_ids() -> None:
    base = datetime(2026, 12, 31).date()
    assert resolve_date("tomorrow", "UTC", today=base).isoformat() == "2027-01-01"
    assert resolve_date("2026-10-05", "UTC").isoformat() == "2026-10-05"
    eid = event_id_for("task:tool:hash")
    assert eid == event_id_for("task:tool:hash") and set(eid) <= set("0123456789abcdefghijklmnopqrstuv")
    assert 5 <= len(eid) <= 1024
