"""Built-in suites and the case schema."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.evaluation.cases import (
    SUITES,
    Category,
    EvaluationCase,
    Expectations,
    SideEffectBound,
    acbe_suite,
    all_cases,
    cases_for_categories,
    core_suite,
    get_suite,
    scopes_for_capabilities,
)
from app.evaluation.cli import build_parser, main


def test_core_suite_covers_the_required_scenarios() -> None:
    cases = core_suite()
    ids = [c.id for c in cases]
    assert len(cases) >= 12
    assert len(ids) == len(set(ids))
    for required in ("core.happy_path", "core.read_timeout_retry", "core.write_timeout_after_effect",
                     "core.email_503_before_effect", "core.oauth_expired", "core.insufficient_scope",
                     "core.invalid_recipient", "core.missing_contact_input", "core.verification_mismatch",
                     "core.approval_rejected", "core.prompt_injection_email", "core.unknown_tool_rejected"):
        assert required in ids, required
    assert {c.category for c in cases} >= {"planning", "tool_selection", "argument_correctness", "execution",
                                            "verification", "recovery", "permission_safety", "memory_retrieval"}
    assert all(c.plan is not None and not c.use_model for c in cases), "core must be deterministic"
    assert all(c.category in Category.ALL for c in all_cases())


def test_every_case_that_contacts_people_declares_the_approval_oracle() -> None:
    happy = next(c for c in core_suite() if c.id == "core.happy_path")
    assert happy.expectations.approval_required == ["calendar.create_event", "gmail.send"]
    injection = next(c for c in core_suite() if c.id == "core.prompt_injection_email")
    assert injection.expectations.approval_required == ["gmail.send"]
    lag = acbe_suite()[0]
    assert lag.expectations.approval_required == []  # no attendees: a private calendar block


def test_suite_registry_and_category_filter() -> None:
    assert set(SUITES) >= {"core", "acbe"}
    assert [c.id for c in get_suite("acbe")] == ["acbe.calendar_readback_lag"]
    with pytest.raises(KeyError):
        get_suite("nope")
    verification = {c.id for c in cases_for_categories({"verification"})}
    assert verification == {"core.verification_mismatch", "acbe.calendar_readback_lag"}


def test_case_needs_a_plan_or_the_model() -> None:
    with pytest.raises(ValidationError):
        EvaluationCase(id="x.case", category="planning", goal="g", expectations=Expectations(final_status=["x"]))
    case = EvaluationCase(id="x.case", category="planning", goal="g", use_model=True,
                          expectations=Expectations(final_status=["completed"]))
    assert case.plan is None
    with pytest.raises(ValidationError):
        EvaluationCase(id="Bad Id", category="planning", goal="g", use_model=True,
                       expectations=Expectations(final_status=["completed"]))


def test_side_effect_bounds() -> None:
    assert SideEffectBound(exactly=1).check(1) and not SideEffectBound(exactly=1).check(2)
    assert SideEffectBound(at_least=1, at_most=2).check(2)
    assert not SideEffectBound(at_most=0).check(1)
    assert SideEffectBound().check(7)


def test_scopes_for_capabilities() -> None:
    scopes = scopes_for_capabilities(["calendar.read", "contacts.read"])
    assert scopes[:3] == ["openid", "email", "profile"]
    assert "https://www.googleapis.com/auth/calendar.readonly" in scopes
    assert not any("calendar.events" in s for s in scopes)


def test_cli_parser_and_listing(capsys: pytest.CaptureFixture[str]) -> None:
    args = build_parser().parse_args(["run", "--suite", "core", "--case", "core.happy_path", "--repetitions", "2"])
    assert (args.suite, args.case, args.repetitions, args.model) == ("core", ["core.happy_path"], 2, "scripted")
    assert main(["list"]) == 0
    out = capsys.readouterr().out
    assert "core.prompt_injection_email" in out and "acbe.calendar_readback_lag" in out


def test_cli_release_gate_exit_codes() -> None:
    from app.evaluation.cli import release_gate

    assert release_gate("completed", {"unauthorized_action_rate": 0.0, "false_completion_rate": 0.0}) == (0, [])
    code, problems = release_gate("completed", {"unauthorized_action_rate": 0.0, "false_completion_rate": 0.1})
    assert code == 1 and problems == ["false_completion_rate=0.1"]
    code, problems = release_gate("completed", {"unauthorized_action_rate": 0.05, "false_completion_rate": 0.0})
    assert code == 1 and problems == ["unauthorized_action_rate=0.05"]
    assert release_gate("failed", {})[0] == 1
