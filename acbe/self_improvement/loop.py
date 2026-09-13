"""
The Self-Improvement Loop -- the central architectural layer of ACBE.

    Task -> Agent -> Observe -> Plan -> Act -> Verify -> Result
         -> Evaluator -> Failure/Success Analysis -> Root Cause Analysis
         -> Improvement Proposal -> Counterfactual Strategy Generation
         -> Candidate Ranking -> Experiment -> Evaluation -> Promotion Gate
         -> Keep / Reject / Rollback -> Strategy Memory -> Cross-Task Transfer
         -> Future Execution -> Continuous Learning

Every other module in ``acbe`` (browser, observation, failure, counterfactual,
strategy, memory, efficiency, evolution, evaluation, safety, telemetry) is a
component this loop orchestrates -- none of them is meant to be the "main"
entry point on its own.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

from acbe.core.config import ACBEConfig
from acbe.core.types import ExperimentStatus, LocatorStrategy, Trajectory, new_id
from acbe.evaluation.evaluator import EvaluationResult, Evaluator
from acbe.evolution.promotion import PromotionGate
from acbe.evolution.rollback import VersionHistory
from acbe.experiments.runner import EpisodeResult, ExperimentRunner, Task, run_episode
from acbe.experiments.store import ExperimentStore
from acbe.failure.fingerprint import FailureFingerprint, FailureFingerprintBuilder
from acbe.failure.store import FailureStore
from acbe.memory.base import StrategyMemory
from acbe.safety.guard import SafetyGuard
from acbe.self_improvement.candidate import generate_and_rank
from acbe.self_improvement.experience import ExperienceBuffer
from acbe.self_improvement.improvement import ImprovementOutcome, ImprovementProposal
from acbe.self_improvement.metrics import SelfImprovementMetricsTracker
from acbe.self_improvement.root_cause import RootCauseAnalyzer
from acbe.self_improvement.transfer import CrossTaskTransfer
from acbe.strategy.models import Strategy, StrategyLifecycle
from acbe.telemetry.tracer import Tracer


@dataclass
class SelfImprovementRunOutcome:
    trajectory: Trajectory
    success: bool
    used_transfer_strategy: Optional[str] = None
    improvement: Optional[ImprovementOutcome] = None


class SelfImprovementLoop:
    def __init__(
        self,
        *,
        memory: StrategyMemory,
        config: Optional[ACBEConfig] = None,
        agent_version: str = "agent-v1",
        evaluator: Optional[Evaluator] = None,
        tracer: Optional[Tracer] = None,
        safety_guard: Optional[SafetyGuard] = None,
        version_history: Optional[VersionHistory] = None,
    ):
        self.config = config or ACBEConfig()
        self.memory = memory
        self.agent_version = agent_version
        self.evaluator = evaluator or Evaluator()
        self.tracer = tracer or Tracer(self.config.trace_dir)
        self.safety = safety_guard or SafetyGuard(self.config)
        self.version_history = version_history or VersionHistory(self.config.db_path)
        self.failure_store = FailureStore(self.config.db_path)
        self.experiment_store = ExperimentStore(self.config.db_path)
        self.root_cause_analyzer = RootCauseAnalyzer()
        self.promotion_gate = PromotionGate(self.config)
        self.transfer = CrossTaskTransfer(self.memory)
        self.experiment_runner = ExperimentRunner()
        self.experience = ExperienceBuffer()
        self.metrics = SelfImprovementMetricsTracker()
        self.failures: List[FailureFingerprint] = []
        self._experiment_counter = 0
        self.version_history.record("agent", self.agent_version, metadata={"created_by": "SelfImprovementLoop.__init__"})

    # -- Section: EXPERIENCE COLLECTION + EVALUATION -----------------------
    async def _execute(self, task: Task) -> Tuple[EpisodeResult, Optional[Strategy], LocatorStrategy]:
        """RUN -> COLLECT. Chooses a locator strategy (possibly via
        cross-task transfer) and executes the task once."""
        locator = task.baseline_locator
        transfer_strategy: Optional[Strategy] = None

        if self.config.memory_enabled and task.expected_failure_pattern:
            candidates = await self.transfer.find_transferable(
                task.expected_failure_pattern, task.environment.env_id,
            )
            if candidates:
                transfer_strategy = candidates[0]
                self.metrics.record_strategy_reuse(hit=True)
                primary = transfer_strategy.actions[0]["locator_strategy"]
                locator = LocatorStrategy(primary)
            else:
                self.metrics.record_strategy_reuse(hit=False)

        result = await run_episode(
            task, locator, agent_version=self.agent_version,
            strategy_version=(transfer_strategy.version if transfer_strategy else "baseline"),
        )
        self.experience.add(result.trajectory)
        self.tracer.event(
            task.task_id, self.agent_version, locator.value,
            event="episode_complete", success=result.success,
            tokens=result.trajectory.total_tokens,
        )
        return result, transfer_strategy, locator

    def _build_fingerprint(self, task: Task, result: EpisodeResult) -> FailureFingerprint:
        return FailureFingerprintBuilder.from_episode_result(
            task_id=task.task_id, environment_id=task.environment.env_id, result=result,
        )

    # -- public: EVALUATE ----------------------------------------------------
    def evaluate(self, trajectory: Trajectory) -> EvaluationResult:
        """Independent evaluation -- deliberately does not accept the agent
        instance, only the recorded trajectory (Section 2)."""
        return self.evaluator.evaluate(trajectory)

    # -- public: RUN_AND_IMPROVE ---------------------------------------------
    async def run_and_improve(
        self,
        task: Task,
        *,
        replay_variants: Optional[List[Task]] = None,
        regression_tasks: Optional[List[Task]] = None,
    ) -> SelfImprovementRunOutcome:
        result, transfer_strategy, locator = await self._execute(task)

        if result.success:
            if transfer_strategy is not None:
                attempt = await self.transfer.apply_and_record(
                    transfer_strategy, transfer_strategy.failure_pattern,
                    task.environment.env_id, success=True,
                    token_cost=result.trajectory.total_tokens,
                )
                self.metrics.record_transfer(success=attempt.success)
            return SelfImprovementRunOutcome(
                trajectory=result.trajectory, success=True,
                used_transfer_strategy=transfer_strategy.strategy_id if transfer_strategy else None,
            )

        if transfer_strategy is not None:
            attempt = await self.transfer.apply_and_record(
                transfer_strategy, transfer_strategy.failure_pattern,
                task.environment.env_id, success=False,
                token_cost=result.trajectory.total_tokens,
            )
            self.metrics.record_transfer(success=attempt.success)

        fingerprint = self._build_fingerprint(task, result)
        self.failures.append(fingerprint)
        self.failure_store.save(fingerprint)

        if not self.config.self_improvement_enabled:
            return SelfImprovementRunOutcome(trajectory=result.trajectory, success=False)

        improvement = await self._improve_from_failure(
            task, fingerprint, baseline_locator=locator,
            replay_variants=replay_variants, regression_tasks=regression_tasks,
        )
        return SelfImprovementRunOutcome(trajectory=result.trajectory, success=False, improvement=improvement)

    async def _improve_from_failure(
        self,
        task: Task,
        fingerprint: FailureFingerprint,
        *,
        baseline_locator: LocatorStrategy,
        replay_variants: Optional[List[Task]],
        regression_tasks: Optional[List[Task]],
    ) -> Optional[ImprovementOutcome]:
        # ROOT CAUSE ANALYSIS
        root_cause = self.root_cause_analyzer.analyze(fingerprint)

        # COUNTERFACTUAL STRATEGY GENERATION + CANDIDATE RANKING
        candidates = generate_and_rank(fingerprint, self.config)
        if not candidates:
            return None
        top_candidate = candidates[0]
        proposal = ImprovementProposal.new(fingerprint, root_cause, candidates)

        # EXPERIMENT (sandbox/replay -> benchmark evaluation -> regression testing)
        task_set = replay_variants if replay_variants else [task]
        candidate_locator = LocatorStrategy(top_candidate.actions[0]["locator_strategy"])
        self._experiment_counter += 1
        experiment = await self.experiment_runner.run(
            experiment_id=new_id("exp"),
            baseline_version=self.agent_version,
            candidate_version=f"{self.agent_version}+{top_candidate.strategy_id[:8]}",
            strategy_id=top_candidate.strategy_id,
            task_set=task_set,
            baseline_locator=baseline_locator,
            candidate_locator=candidate_locator,
            regression_task_set=regression_tasks,
        )

        # PROMOTION GATE -> KEEP / REJECT / ROLLBACK / NEEDS_MORE_DATA
        experiment = self.promotion_gate.evaluate(experiment)
        self.metrics.record_experiment(experiment)
        self.experiment_store.save(experiment)

        promoted_strategy: Optional[Strategy] = None
        if experiment.status == ExperimentStatus.PROMOTE:
            top_candidate.lifecycle = StrategyLifecycle.PROMOTED
            top_candidate.expected_gain = experiment.improvement_gain
            top_candidate.record_trial(
                success=True, token_cost=int(experiment.avg_candidate_tokens),
                environment_id=task.environment.env_id,
            )
            await self.memory.store(top_candidate)
            self.version_history.record(
                "strategy", f"{top_candidate.version}-{top_candidate.strategy_id[:8]}",
                metadata=top_candidate.to_dict(),
            )
            promoted_strategy = top_candidate
        elif experiment.status == ExperimentStatus.ROLLBACK:
            # Never silently overwrite a working strategy: explicitly point
            # the active "strategy" version pointer back at its parent, if any.
            current = self.version_history.current("strategy")
            if current:
                self.version_history.rollback("strategy", current, reason=experiment.decision_reason)

        return ImprovementOutcome(
            proposal=proposal, fingerprint=fingerprint, root_cause=root_cause,
            candidates=candidates, top_candidate=top_candidate, experiment=experiment,
            promoted_strategy=promoted_strategy,
        )

    # -- granular public API mirroring the spec (Section 14 of the update) --
    async def self_improve(self, fingerprint: FailureFingerprint, task: Task,
                            replay_variants: Optional[List[Task]] = None,
                            regression_tasks: Optional[List[Task]] = None) -> Optional[ImprovementOutcome]:
        return await self._improve_from_failure(
            task, fingerprint, baseline_locator=task.baseline_locator,
            replay_variants=replay_variants, regression_tasks=regression_tasks,
        )

    def promote(self, strategy: Strategy) -> None:
        self.safety.check_protected_component("promotion_thresholds", human_approved=True)
        strategy.lifecycle = StrategyLifecycle.PROMOTED

    def rollback(self, target_version: str, reason: str = "manual rollback") -> str:
        return self.version_history.rollback("strategy", target_version, reason=reason)

    def summary(self) -> dict:
        return {
            "agent_version": self.agent_version,
            "trajectories_run": len(self.experience.all()),
            "success_rate": round(self.experience.success_rate(), 4),
            "failures_recorded": len(self.failures),
            **self.metrics.summary(),
        }
