import tempfile
import unittest
from pathlib import Path

from acbe.core.config import ACBEConfig
from acbe.core.types import ExperimentStatus
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.loop import SelfImprovementLoop
from acbe.strategy.models import StrategyLifecycle
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


class TestSelfImprovementLoopEndToEnd(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self._tmp.name) / "acbe.db")
        self.config = ACBEConfig(
            db_path=self.db_path,
            promotion_min_sample_size=8,
            promotion_max_token_increase_ratio=10.0,  # see benchmarks/run_benchmark.py
        )
        self.memory = SQLiteStrategyMemory(self.db_path)
        self.loop = SelfImprovementLoop(memory=self.memory, config=self.config)

    async def asyncTearDown(self):
        self._tmp.cleanup()

    async def test_naive_agent_fails_then_recovers_and_is_promoted(self):
        training = wrong_element_family(10)
        regression = wrong_element_regression_family(4)

        outcome = await self.loop.run_and_improve(training[0], replay_variants=training, regression_tasks=regression)

        # 1. the naive first attempt genuinely fails (this is not a trivial task)
        self.assertFalse(outcome.success)
        self.assertIsNotNone(outcome.improvement)

        imp = outcome.improvement
        self.assertEqual(imp.fingerprint.failure_type, "WRONG_ELEMENT")
        self.assertTrue(imp.root_cause.likely_cause)
        self.assertGreaterEqual(len(imp.candidates), 1)

        # 2. the experiment shows a real, promotable improvement
        self.assertEqual(imp.experiment.status, ExperimentStatus.PROMOTE)
        self.assertGreater(imp.experiment.improvement_gain, 0.5)

        # 3. it was actually promoted and persisted to memory
        self.assertIsNotNone(imp.promoted_strategy)
        self.assertEqual(imp.promoted_strategy.lifecycle, StrategyLifecycle.PROMOTED)
        stored = await self.memory.get(imp.promoted_strategy.strategy_id)
        self.assertIsNotNone(stored)
        self.assertEqual(stored.lifecycle, StrategyLifecycle.PROMOTED)

        # 4. version history recorded it
        self.assertIsNotNone(self.loop.version_history.current("strategy"))

    async def test_promoted_strategy_transfers_to_unseen_environments(self):
        training = wrong_element_family(10)
        regression = wrong_element_regression_family(4)
        await self.loop.run_and_improve(training[0], replay_variants=training, regression_tasks=regression)

        transfer_tasks = wrong_element_family(3)
        for i, t in enumerate(transfer_tasks):
            t.task_id = f"unseen_shop_{i}"

        successes = 0
        used_transfer = 0
        for t in transfer_tasks:
            result = await self.loop.run_and_improve(t)
            successes += int(result.success)
            used_transfer += int(result.used_transfer_strategy is not None)

        self.assertEqual(successes, len(transfer_tasks))
        self.assertEqual(used_transfer, len(transfer_tasks))
        self.assertGreater(self.loop.metrics.cross_task_transfer_rate, 0.0)

    async def test_failures_and_experiments_are_persisted_across_loop_instances(self):
        training = wrong_element_family(10)
        regression = wrong_element_regression_family(4)
        await self.loop.run_and_improve(training[0], replay_variants=training, regression_tasks=regression)

        # simulate a brand-new process reading the same database
        from acbe.experiments.store import ExperimentStore
        from acbe.failure.store import FailureStore

        self.assertGreaterEqual(len(FailureStore(self.db_path).list_all()), 1)
        self.assertGreaterEqual(len(ExperimentStore(self.db_path).list_all()), 1)

    async def test_summary_reports_sane_metrics(self):
        training = wrong_element_family(10)
        regression = wrong_element_regression_family(4)
        await self.loop.run_and_improve(training[0], replay_variants=training, regression_tasks=regression)
        summary = self.loop.summary()
        self.assertEqual(summary["verified_improvements"], 1)
        self.assertEqual(summary["rolled_back_improvements"], 0)
        self.assertGreaterEqual(summary["failures_recorded"], 1)


if __name__ == "__main__":
    unittest.main()
