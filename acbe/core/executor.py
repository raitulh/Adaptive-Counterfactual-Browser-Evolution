"""
Executes a task by letting a real ``AgentAdapter`` choose actions step by
step (Observe -> Plan -> Act -> Verify), as opposed to
``acbe.experiments.runner.run_episode`` which replays a fixed script.

Crucially, every action the agent takes is recorded as a ``TaskStep``. If
the run fails, that recording can be turned back into a ``Task`` via
``build_replay_task`` -- which is what lets the self-improvement loop
sandbox/replay counterfactual locator strategies even for *free-form*,
agent-planned runs: the replay re-issues the same target descriptions with
a different ``locator_strategy`` against a fresh copy of the same
environment.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional

from acbe.agents.base import AgentAdapter, AgentFinished
from acbe.browser.base import BrowserActionError
from acbe.browser.mock_adapter import EnvironmentSpec, MockBrowserAdapter
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, StepRecord, Trajectory, new_id
from acbe.experiments.runner import EpisodeResult, Task, TaskStep, _tokens_for
from acbe.observation.state_extractor import StateExtractor

DEFAULT_MAX_STEPS = 12


@dataclass
class AgentRunResult(EpisodeResult):
    recorded_steps: Optional[List[TaskStep]] = None


async def run_agent_episode(
    *,
    agent: AgentAdapter,
    environment: EnvironmentSpec,
    goal: str,
    goal_verification: str,
    task_id: Optional[str] = None,
    agent_version: str = "agent-v1",
    max_steps: int = DEFAULT_MAX_STEPS,
) -> AgentRunResult:
    task_id = task_id or new_id("task")
    browser = MockBrowserAdapter(environment)
    await browser.start()
    extractor = StateExtractor()
    trajectory = Trajectory(
        trajectory_id=new_id("traj"), task_id=task_id, task_description=goal,
        environment_id=environment.env_id, agent_version=agent_version, strategy_version="agent-planned",
    )
    history: List[ActionRecord] = []
    recorded_steps: List[TaskStep] = []

    try:
        for _ in range(max_steps):
            raw_before = await browser.observe()
            obs_before = extractor.extract(raw_before, goal=goal)
            try:
                action = await agent.plan(goal=goal, observation=obs_before, history=history)
            except AgentFinished:
                break

            history.append(action)
            tin, tout = _tokens_for(action.action_type, action.locator_strategy)
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
                # Record the failed step too (not just successful ones) --
                # replaying this exact target description with a different
                # locator strategy is the whole point of build_replay_task.
                recorded_steps.append(TaskStep(action_type=action.action_type,
                                                target_description=action.target_description,
                                                params=action.params))
                return AgentRunResult(
                    trajectory=trajectory, success=False, error=exc, failed_step=step,
                    recorded_steps=recorded_steps,
                )

            recorded_steps.append(TaskStep(action_type=action.action_type,
                                            target_description=action.target_description,
                                            params=action.params))
            obs_after = extractor.extract(raw_after, goal=goal, recent_action=action.action_type.value)
            step = StepRecord(
                step_id=new_id("step"), action=action, observation_before=obs_before,
                observation_after=obs_after, verification=None, success=True,
                tokens_input=tin, tokens_output=tout, model_calls=1,
            )
            trajectory.steps.append(step)

            verification = await browser.verify(goal_verification)
            if verification.verified:
                verify_action = ActionRecord(
                    action_id=new_id("act"), action_type=ActionType.VERIFY,
                    target_description=goal_verification, locator_strategy=action.locator_strategy,
                )
                verify_step = StepRecord(
                    step_id=new_id("step"), action=verify_action, observation_before=obs_after,
                    observation_after=obs_after, verification=verification, success=True,
                    tokens_input=10, tokens_output=5, model_calls=0,
                )
                trajectory.steps.append(verify_step)
                trajectory.finalize(success=True)
                return AgentRunResult(trajectory=trajectory, success=True, recorded_steps=recorded_steps)

        # Ran out of steps (or agent stopped early) without verifying the goal.
        final_verification = await browser.verify(goal_verification)
        verify_action = ActionRecord(
            action_id=new_id("act"), action_type=ActionType.VERIFY,
            target_description=goal_verification, locator_strategy=LocatorStrategy.ROLE_NAME,
        )
        raw_final = await browser.observe()
        obs_final = extractor.extract(raw_final, goal=goal)
        verify_step = StepRecord(
            step_id=new_id("step"), action=verify_action, observation_before=obs_final,
            observation_after=obs_final, verification=final_verification, success=final_verification.verified,
            tokens_input=10, tokens_output=5, model_calls=0,
        )
        trajectory.steps.append(verify_step)
        trajectory.finalize(success=final_verification.verified)
        return AgentRunResult(
            trajectory=trajectory, success=final_verification.verified,
            failed_step=None if final_verification.verified else verify_step,
            recorded_steps=recorded_steps,
        )
    finally:
        await browser.close()


def build_replay_task(
    *, task_id: str, goal: str, category: str, environment: EnvironmentSpec,
    recorded_steps: List[TaskStep], goal_verification: str,
    baseline_locator: LocatorStrategy, expected_failure_pattern: Optional[str] = None,
) -> Task:
    """Turns a recorded agent run back into a replayable ``Task`` so the
    self-improvement loop can sandbox-test alternative locator strategies
    against the exact same target descriptions the agent chose.

    ``goal_verification`` is almost always best passed as
    ``acbe.experiments.runner.STEPS_COMPLETE`` here: the recording only
    covers what the agent actually attempted before it failed, which may be
    a strict prefix of what the *original*, un-recorded task needed to
    reach its true end state. What the counterfactual/experiment pipeline
    needs to know is narrower -- "does an alternative locator strategy get
    through the recorded steps without failing?" -- which ``STEPS_COMPLETE``
    checks directly, rather than re-imposing a goal the partial recording
    was never guaranteed to be able to reach on its own.
    """
    return Task(
        task_id=task_id, description=goal, category=category, environment=environment,
        steps=list(recorded_steps), goal_verification=goal_verification,
        baseline_locator=baseline_locator, expected_failure_pattern=expected_failure_pattern,
    )
