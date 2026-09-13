"""
ACBE -- Adaptive Counterfactual Browser Evolution
==================================================

"The self-improvement layer for AI agents."

An AI agent should not only learn from success. It should learn from
verified failure, test better alternatives, transfer what it learns, and
become more efficient over time.

This package is *not* AGI, and does not claim to be. It explores a
failure-conditioned, counterfactual strategy-evolution architecture for
computer-use agents, with explicit optimization for reliability, transfer,
and inference efficiency. See ``research/prior_art.md`` and
``research/hypotheses.md`` for the research framing.

Quick start
-----------
    from acbe import ACBE

    system = ACBE(agent=my_agent, browser="mock", memory=True,
                   self_improvement=True, token_optimization=True)
    result = system.run("Find a product and add it to the cart")

    # or, wrapping an existing agent object:
    agent = ACBE.wrap(my_agent)
    result = agent.run(task)
"""

from __future__ import annotations

import asyncio
from typing import Any, List, Optional, Union

from acbe.agents.base import AgentAdapter
from acbe.browser.mock_adapter import EnvironmentSpec
from acbe.core.config import ACBEConfig
from acbe.core.executor import build_replay_task, run_agent_episode
from acbe.core.types import LocatorStrategy, RunResult
from acbe.efficiency.token_tracker import TokenTracker
from acbe.evaluation.evaluator import EvaluationResult
from acbe.experiments.runner import STEPS_COMPLETE, EpisodeResult, Task, run_episode
from acbe.failure.fingerprint import FailureFingerprintBuilder
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.improvement import ImprovementOutcome
from acbe.self_improvement.loop import SelfImprovementLoop
from acbe.telemetry.tracer import Tracer

__version__ = "0.1.0-mvp"


class ACBE:
    """The self-improvement layer for AI agents.

    Two usage patterns are supported:

    * **Task-based** (recommended -- this is what the bundled benchmark and
      test suite use, and what the self-improvement loop can reliably
      sandbox/replay)::

          result = system.run(my_task)               # a acbe.experiments.Task
          result = system.run_and_improve(my_task)

    * **Free-text convenience**, backed by a supplied ``AgentAdapter`` and a
      sandbox ``EnvironmentSpec``::

          result = system.run("Find a product and add it to the cart")

      Every action the agent takes is recorded, so if the run fails,
      ``run_and_improve`` can still sandbox-test counterfactual locator
      strategies by replaying the exact same recorded actions against a
      fresh copy of the environment (see ``acbe.core.executor``).
    """

    def __init__(
        self,
        agent: Optional[AgentAdapter] = None,
        browser: str = "mock",
        memory: bool = True,
        self_improvement: bool = True,
        token_optimization: bool = True,
        environment: Optional[EnvironmentSpec] = None,
        config: Optional[ACBEConfig] = None,
        db_path: Optional[str] = None,
    ):
        self.config = config or ACBEConfig(
            memory_enabled=memory,
            self_improvement_enabled=self_improvement,
            token_optimization_enabled=token_optimization,
        )
        if db_path:
            self.config.db_path = db_path
        self.config.ensure_dirs()

        self.agent = agent
        self.browser_backend = browser
        self.environment = environment
        self.token_optimization = token_optimization
        self.token_tracker = TokenTracker()
        self.tracer = Tracer(self.config.trace_dir)

        self.memory_store = SQLiteStrategyMemory(self.config.db_path) if memory else None
        self.loop: Optional[SelfImprovementLoop] = None
        if memory and self_improvement:
            self.loop = SelfImprovementLoop(memory=self.memory_store, config=self.config)

        self.last_result: Optional[EpisodeResult] = None
        self.last_replay_task: Optional[Task] = None
        self.last_improvement: Optional[ImprovementOutcome] = None

    @classmethod
    def wrap(cls, agent: AgentAdapter, **kwargs: Any) -> "ACBE":
        return cls(agent=agent, **kwargs)

    # -- synchronous convenience wrappers ------------------------------------
    def run(self, task: Union[str, Task], **kwargs: Any) -> RunResult:
        return asyncio.run(self.run_async(task, **kwargs))

    def run_and_improve(self, task: Union[str, Task], **kwargs: Any) -> RunResult:
        return asyncio.run(self.run_and_improve_async(task, **kwargs))

    def evaluate(self) -> Optional[EvaluationResult]:
        if self.loop is None or self.last_result is None:
            return None
        return self.loop.evaluate(self.last_result.trajectory)

    def promote(self, strategy) -> None:
        if self.loop is None:
            raise RuntimeError("self_improvement is disabled -- nothing to promote.")
        self.loop.promote(strategy)

    def rollback(self, target_version: str, reason: str = "manual rollback") -> str:
        if self.loop is None:
            raise RuntimeError("self_improvement is disabled -- no version history to roll back.")
        return self.loop.rollback(target_version, reason=reason)

    def summary(self) -> dict:
        return self.loop.summary() if self.loop else {"self_improvement": "disabled"}

    # -- core async API -----------------------------------------------------
    async def run_async(self, task: Union[str, Task], *, goal_verification: Optional[str] = None) -> RunResult:
        if isinstance(task, Task):
            result = await run_episode(task, task.baseline_locator, agent_version="agent-v1")
            self.last_replay_task = task
        else:
            result, replay_task = await self._run_free_text(task, goal_verification)
            self.last_replay_task = replay_task
        self.last_result = result
        description = task if isinstance(task, str) else task.description
        return self._to_run_result(description, result)

    async def run_and_improve_async(
        self,
        task: Union[str, Task],
        *,
        goal_verification: Optional[str] = None,
        replay_variants: Optional[List[Task]] = None,
        regression_tasks: Optional[List[Task]] = None,
    ) -> RunResult:
        if self.loop is None:
            return await self.run_async(task, goal_verification=goal_verification)

        if isinstance(task, Task):
            outcome = await self.loop.run_and_improve(
                task, replay_variants=replay_variants, regression_tasks=regression_tasks,
            )
            self.last_result = EpisodeResult(trajectory=outcome.trajectory, success=outcome.success)
            self.last_replay_task = task
            self.last_improvement = outcome.improvement
            description = task.description
            return self._to_run_result(description, self.last_result, improvement=outcome.improvement)

        result, replay_task = await self._run_free_text(task, goal_verification)
        self.last_result = result
        self.last_replay_task = replay_task

        if result.success:
            return self._to_run_result(task, result)

        fingerprint = FailureFingerprintBuilder.from_episode_result(
            task_id=replay_task.task_id, environment_id=replay_task.environment.env_id, result=result,
        )
        self.loop.failures.append(fingerprint)
        self.loop.failure_store.save(fingerprint)
        improvement = await self.loop.self_improve(
            fingerprint, replay_task, replay_variants=replay_variants, regression_tasks=regression_tasks,
        )
        self.last_improvement = improvement
        return self._to_run_result(task, result, improvement=improvement)

    # -- internals ------------------------------------------------------------
    async def _run_free_text(self, goal: str, goal_verification: Optional[str]):
        if self.agent is None:
            raise ValueError("ACBE(agent=...) must be supplied to run free-text tasks.")
        if self.environment is None:
            raise ValueError(
                "A sandbox `environment=EnvironmentSpec(...)` must be supplied for free-text "
                "runs against the mock backend. For real websites, use browser='playwright' "
                "with acbe.browser.playwright_adapter.PlaywrightBrowserAdapter directly, or pass "
                "a Task built around it."
            )
        result = await run_agent_episode(
            agent=self.agent, environment=self.environment, goal=goal,
            goal_verification=goal_verification or self.environment.goal_state,
        )
        # Use whichever locator strategy the agent actually used, so a
        # subsequent A/B experiment compares candidates against the agent's
        # *real* baseline behavior rather than an arbitrary default.
        original_locator = (
            result.trajectory.steps[0].action.locator_strategy
            if result.trajectory.steps else LocatorStrategy.TEXT_VISUAL
        )
        replay_task = build_replay_task(
            task_id=result.trajectory.task_id, goal=goal, category="agent_recorded",
            environment=self.environment, recorded_steps=result.recorded_steps or [],
            goal_verification=STEPS_COMPLETE,
            baseline_locator=original_locator,
        )
        return result, replay_task

    def _to_run_result(self, task_description: str, result: EpisodeResult,
                        improvement: Optional[ImprovementOutcome] = None) -> RunResult:
        fingerprint_id = improvement.fingerprint.fingerprint_id if improvement else None
        return RunResult(
            task=task_description,
            success=result.success,
            trajectory_id=result.trajectory.trajectory_id,
            steps_taken=len(result.trajectory.steps),
            tokens_used=result.trajectory.total_tokens,
            latency_ms=result.trajectory.total_latency_ms,
            failure_fingerprint_id=fingerprint_id,
            improvement_triggered=improvement is not None,
            improvement_result=(
                {
                    "failure_type": improvement.fingerprint.failure_type,
                    "root_cause": improvement.root_cause.likely_cause,
                    "experiment_status": improvement.experiment.status.value,
                    "decision_reason": improvement.experiment.decision_reason,
                    "promoted": improvement.promoted_strategy is not None,
                }
                if improvement else None
            ),
        )


__all__ = ["ACBE", "__version__"]
