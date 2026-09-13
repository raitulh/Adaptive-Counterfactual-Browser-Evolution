"""
Experiment Engine (Section 12).

``run_episode`` executes a single task against the sandbox (or any other
``BrowserAdapter``) with a chosen locator strategy and returns a fully
populated ``Trajectory`` plus failure information. ``ExperimentRunner`` uses
it to run baseline-vs-candidate A/B comparisons and a held-out regression
suite, producing the ``Experiment`` object the ``PromotionGate`` decides on.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

from acbe.browser.base import BrowserActionError
from acbe.browser.mock_adapter import EnvironmentSpec, MockBrowserAdapter
from acbe.core.types import (
    ActionRecord,
    ActionType,
    Experiment,
    LocatorStrategy,
    StepRecord,
    Trajectory,
    VerificationResult,
    new_id,
)
from acbe.observation.state_extractor import StateExtractor
from acbe.strategy.ranking import DEFAULT_HEURISTIC, LOCATOR_HEURISTICS


@dataclass
class TaskStep:
    action_type: ActionType
    target_description: str
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Task:
    task_id: str
    description: str
    category: str
    environment: EnvironmentSpec
    steps: List[TaskStep]
    goal_verification: str
    baseline_locator: LocatorStrategy = LocatorStrategy.TEXT_VISUAL
    expected_failure_pattern: Optional[str] = None


# Sentinel ``goal_verification`` value meaning "success = every recorded
# step executed without raising a BrowserActionError", rather than "the
# environment's backend verify() confirmed some specific end state".
#
# This matters for replay tasks built from a *partial*, previously-failed
# agent recording (see acbe.core.executor.build_replay_task): the recording
# only contains the steps the agent actually attempted before failing, so
# it may never reach the original task's true end state even when every
# recorded step is replayed successfully with a better locator strategy.
# What we actually want to know in that case is narrower and answerable:
# "does this alternative locator strategy get past the point where the
# original attempt failed?" -- not "does this partial trace, replayed
# as-is, happen to satisfy the same goal the full (unrecorded) task had".
STEPS_COMPLETE = "__steps_complete__"


@dataclass
class EpisodeResult:
    trajectory: Trajectory
    success: bool
    error: Optional[BrowserActionError] = None
    failed_step: Optional[StepRecord] = None


def _tokens_for(action_type: ActionType, locator_strategy: LocatorStrategy) -> Tuple[int, int]:
    if action_type == ActionType.WAIT:
        return 20, 5
    h = LOCATOR_HEURISTICS.get(locator_strategy.value, DEFAULT_HEURISTIC)
    total = h["token_cost"]
    return int(total * 0.7), int(total * 0.3)


async def run_episode(
    task: Task,
    locator_strategy: LocatorStrategy,
    *,
    agent_version: str = "baseline",
    strategy_version: str = "1.0",
) -> EpisodeResult:
    browser = MockBrowserAdapter(task.environment)
    await browser.start()
    extractor = StateExtractor()
    trajectory = Trajectory(
        trajectory_id=new_id("traj"),
        task_id=task.task_id,
        task_description=task.description,
        environment_id=task.environment.env_id,
        agent_version=agent_version,
        strategy_version=strategy_version,
    )

    try:
        for step_def in task.steps:
            raw_before = await browser.observe()
            obs_before = extractor.extract(raw_before, goal=task.description)
            action = ActionRecord(
                action_id=new_id("act"),
                action_type=step_def.action_type,
                target_description=step_def.target_description,
                locator_strategy=locator_strategy,
                params=step_def.params,
            )
            tin, tout = _tokens_for(step_def.action_type, locator_strategy)
            try:
                raw_after = await browser.act(action)
            except BrowserActionError as exc:
                obs_after = obs_before
                step = StepRecord(
                    step_id=new_id("step"), action=action, observation_before=obs_before,
                    observation_after=obs_after, verification=None, success=False,
                    tokens_input=tin, tokens_output=tout, model_calls=1,
                )
                trajectory.steps.append(step)
                trajectory.finalize(success=False)
                return EpisodeResult(trajectory=trajectory, success=False, error=exc, failed_step=step)

            obs_after = extractor.extract(
                raw_after, goal=task.description, recent_action=step_def.action_type.value,
            )
            step = StepRecord(
                step_id=new_id("step"), action=action, observation_before=obs_before,
                observation_after=obs_after, verification=None, success=True,
                tokens_input=tin, tokens_output=tout, model_calls=1,
            )
            trajectory.steps.append(step)

        if task.goal_verification == STEPS_COMPLETE:
            # Every step executed without raising -- that's the whole bar.
            verification = VerificationResult(
                verified=True, method="steps_complete",
                expected_state=STEPS_COMPLETE, actual_state=STEPS_COMPLETE, confidence=1.0,
            )
        else:
            verification = await browser.verify(task.goal_verification)
        verify_action = ActionRecord(
            action_id=new_id("act"), action_type=ActionType.VERIFY,
            target_description=task.goal_verification, locator_strategy=locator_strategy,
        )
        raw_final = await browser.observe()
        obs_final = extractor.extract(raw_final, goal=task.description)
        verify_step = StepRecord(
            step_id=new_id("step"), action=verify_action, observation_before=obs_final,
            observation_after=obs_final, verification=verification, success=verification.verified,
            tokens_input=10, tokens_output=5, model_calls=0,
        )
        trajectory.steps.append(verify_step)
        trajectory.finalize(success=verification.verified)
        if verification.verified:
            return EpisodeResult(trajectory=trajectory, success=True)
        return EpisodeResult(trajectory=trajectory, success=False, failed_step=verify_step)
    finally:
        await browser.close()


class ExperimentRunner:
    """A/B tests a candidate strategy against a baseline over a task set,
    plus an optional held-out regression suite (Section 12)."""

    async def run(
        self,
        *,
        experiment_id: str,
        baseline_version: str,
        candidate_version: str,
        strategy_id: str,
        task_set: List[Task],
        baseline_locator: LocatorStrategy,
        candidate_locator: LocatorStrategy,
        regression_task_set: Optional[List[Task]] = None,
    ) -> Experiment:
        experiment = Experiment(
            experiment_id=experiment_id,
            baseline_version=baseline_version,
            candidate_version=candidate_version,
            task_set=[t.task_id for t in task_set],
            strategy=strategy_id,
        )

        for task in task_set:
            baseline_result = await run_episode(task, baseline_locator, agent_version=baseline_version)
            experiment.baseline_trials += 1
            experiment.baseline_successes += int(baseline_result.success)
            experiment.baseline_tokens.append(baseline_result.trajectory.total_tokens)

            candidate_result = await run_episode(task, candidate_locator, agent_version=candidate_version)
            experiment.candidate_trials += 1
            experiment.candidate_successes += int(candidate_result.success)
            experiment.candidate_tokens.append(candidate_result.trajectory.total_tokens)

        if regression_task_set:
            for task in regression_task_set:
                result = await run_episode(task, candidate_locator, agent_version=candidate_version)
                experiment.regression_trials += 1
                if not result.success:
                    experiment.regression_failures += 1

        return experiment
