from __future__ import annotations

import pytest

from app.core.exceptions import InvalidStateTransition
from app.tasks.models import TaskStep
from app.tasks.state import STEP_TRANSITIONS, TASK_TRANSITIONS, StepStatus, TaskStatus, can_transition, transition_step


def test_terminal_states_have_no_exits() -> None:
    assert TASK_TRANSITIONS[TaskStatus.COMPLETED] == frozenset()
    assert TASK_TRANSITIONS[TaskStatus.CANCELLED] == frozenset()


def test_completion_only_through_verification() -> None:
    completers = [s for s, targets in TASK_TRANSITIONS.items() if TaskStatus.COMPLETED in targets]
    assert set(completers) <= {TaskStatus.VERIFYING, TaskStatus.CANCEL_REQUESTED}
    assert not can_transition("running", "completed")
    assert can_transition("verifying", "completed")


def test_every_state_is_defined() -> None:
    assert set(TASK_TRANSITIONS) == set(TaskStatus)
    assert set(STEP_TRANSITIONS) == set(StepStatus)


def test_step_transitions_are_enforced() -> None:
    step = TaskStep(status="pending", step_key="s")
    transition_step(step, StepStatus.RUNNING)
    assert step.started_at is not None
    with pytest.raises(InvalidStateTransition):
        transition_step(step, StepStatus.WAITING_APPROVAL)
    transition_step(step, StepStatus.VERIFYING)
    transition_step(step, StepStatus.COMPLETED)
    assert step.completed_at is not None
    with pytest.raises(InvalidStateTransition):
        transition_step(step, StepStatus.PENDING)


def test_step_cannot_complete_without_verification_or_user_confirmation() -> None:
    to_completed = {s for s, targets in STEP_TRANSITIONS.items() if StepStatus.COMPLETED in targets}
    assert to_completed == {StepStatus.VERIFYING, StepStatus.REQUIRES_RECONCILIATION, StepStatus.RUNNING}
