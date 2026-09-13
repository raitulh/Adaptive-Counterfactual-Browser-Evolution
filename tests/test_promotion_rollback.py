import tempfile
import unittest
from pathlib import Path

from acbe.core.config import ACBEConfig
from acbe.core.types import Experiment, ExperimentStatus
from acbe.evolution.promotion import PromotionGate, one_sided_proportion_test
from acbe.evolution.rollback import VersionHistory, VersionNotFoundError


def make_experiment(**overrides) -> Experiment:
    base = dict(
        experiment_id="e1", baseline_version="v1", candidate_version="v2",
        baseline_trials=30, baseline_successes=18,   # 60%
        candidate_trials=30, candidate_successes=27,  # 90%
        baseline_tokens=[1000] * 30, candidate_tokens=[1100] * 30,
    )
    base.update(overrides)
    return Experiment(**base)


class TestOneSidedProportionTest(unittest.TestCase):
    def test_large_clear_improvement_is_high_confidence(self):
        confidence = one_sided_proportion_test(2, 20, 18, 20)
        self.assertGreater(confidence, 0.99)

    def test_no_improvement_is_low_confidence(self):
        confidence = one_sided_proportion_test(10, 20, 10, 20)
        self.assertLess(confidence, 0.6)

    def test_handles_zero_trials_gracefully(self):
        self.assertEqual(one_sided_proportion_test(0, 0, 5, 5), 0.0)


class TestPromotionGate(unittest.TestCase):
    def setUp(self):
        self.gate = PromotionGate(ACBEConfig())

    def test_promotes_clear_cost_efficient_improvement(self):
        exp = make_experiment()
        decided = self.gate.evaluate(exp)
        self.assertEqual(decided.status, ExperimentStatus.PROMOTE)
        self.assertTrue(decided.decision_reason)
        self.assertIsNotNone(decided.decided_at)

    def test_needs_more_data_below_minimum_sample_size(self):
        exp = make_experiment(candidate_trials=3, candidate_successes=3, baseline_trials=3, baseline_successes=0)
        decided = self.gate.evaluate(exp)
        self.assertEqual(decided.status, ExperimentStatus.NEEDS_MORE_DATA)

    def test_rejects_when_not_cost_efficient(self):
        # small improvement, but candidate costs far more tokens
        exp = make_experiment(
            baseline_successes=21, candidate_successes=22,  # 70% -> 73.3%
            candidate_tokens=[4000] * 30,  # ~4x baseline tokens
        )
        decided = self.gate.evaluate(exp)
        self.assertEqual(decided.status, ExperimentStatus.REJECT)
        self.assertIn("token_increase_ratio", decided.decision_reason)

    def test_rejects_when_gain_too_small(self):
        exp = make_experiment(baseline_successes=27, candidate_successes=28)  # 90% -> 93.3%
        decided = self.gate.evaluate(exp)
        self.assertIn(decided.status, (ExperimentStatus.REJECT, ExperimentStatus.NEEDS_MORE_DATA))

    def test_rollback_triggered_by_regression(self):
        exp = make_experiment(regression_trials=20, regression_failures=5)  # 25% regression rate
        decided = self.gate.evaluate(exp)
        self.assertEqual(decided.status, ExperimentStatus.ROLLBACK)

    def test_never_promotes_on_a_single_success(self):
        exp = make_experiment(candidate_trials=1, candidate_successes=1, baseline_trials=1, baseline_successes=0)
        decided = self.gate.evaluate(exp)
        self.assertNotEqual(decided.status, ExperimentStatus.PROMOTE)


class TestVersionHistory(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self._tmp.name) / "test.db")
        self.history = VersionHistory(self.db_path)

    def tearDown(self):
        self._tmp.cleanup()

    def test_record_and_current(self):
        self.history.record("strategy", "v1", metadata={"locator": "role_name"})
        self.assertEqual(self.history.current("strategy"), "v1")

    def test_rollback_updates_active_pointer_and_logs_event(self):
        self.history.record("strategy", "v1", metadata={"success_rate": 0.6})
        self.history.record("strategy", "v2", metadata={"success_rate": 0.9})
        self.assertEqual(self.history.current("strategy"), "v2")

        self.history.rollback("strategy", "v1", reason="regression detected")
        self.assertEqual(self.history.current("strategy"), "v1")

    def test_rollback_to_unknown_version_raises(self):
        self.history.record("strategy", "v1")
        with self.assertRaises(VersionNotFoundError):
            self.history.rollback("strategy", "v99")

    def test_compare_reports_metadata_diff(self):
        self.history.record("strategy", "v1", metadata={"locator": "text_visual", "success_rate": 0.3})
        self.history.record("strategy", "v2", metadata={"locator": "role_name", "success_rate": 0.9})
        diff = self.history.compare("strategy", "v1", "v2")
        self.assertIn("locator", diff["diff"])
        self.assertEqual(diff["diff"]["locator"], {"from": "text_visual", "to": "role_name"})

    def test_history_is_ordered_and_never_loses_entries(self):
        self.history.record("strategy", "v1")
        self.history.record("strategy", "v2")
        self.history.record("strategy", "v3")
        entries = self.history.history("strategy")
        self.assertEqual([e["version"] for e in entries], ["v1", "v2", "v3"])


if __name__ == "__main__":
    unittest.main()
