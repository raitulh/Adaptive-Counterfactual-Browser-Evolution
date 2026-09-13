import unittest

from acbe.core.types import (
    ActionRecord,
    ActionType,
    Experiment,
    ExperimentStatus,
    LocatorStrategy,
    ObservedState,
    VerificationResult,
    new_id,
)


class TestDataclassMixin(unittest.TestCase):
    def test_action_record_roundtrip(self):
        a = ActionRecord(
            action_id=new_id("act"), action_type=ActionType.CLICK,
            target_description="Add to cart", locator_strategy=LocatorStrategy.ROLE_NAME,
            params={"foo": "bar"},
        )
        data = a.to_dict()
        self.assertEqual(data["action_type"], "click")
        self.assertEqual(data["locator_strategy"], "role_name")

        restored = ActionRecord.from_dict(data)
        self.assertEqual(restored.action_type, ActionType.CLICK)
        self.assertIsInstance(restored.action_type, ActionType)
        self.assertEqual(restored.locator_strategy, LocatorStrategy.ROLE_NAME)
        self.assertEqual(restored.params, {"foo": "bar"})

    def test_observed_state_defaults(self):
        s = ObservedState(url="http://x", page_type="home", goal="do a thing")
        self.assertTrue(s.state_change)
        self.assertEqual(s.visible_elements, [])

    def test_verification_result(self):
        v = VerificationResult(verified=True, method="page_id_match", expected_state="page:x", actual_state="page:x")
        self.assertTrue(v.verified)
        self.assertEqual(v.confidence, 1.0)


class TestExperiment(unittest.TestCase):
    def _experiment(self, **overrides) -> Experiment:
        base = dict(
            experiment_id="e1", baseline_version="v1", candidate_version="v2",
            baseline_trials=10, baseline_successes=2, candidate_trials=10, candidate_successes=9,
            baseline_tokens=[100] * 10, candidate_tokens=[150] * 10,
        )
        base.update(overrides)
        return Experiment(**base)

    def test_success_rates(self):
        e = self._experiment()
        self.assertAlmostEqual(e.baseline_success_rate, 0.2)
        self.assertAlmostEqual(e.candidate_success_rate, 0.9)
        self.assertAlmostEqual(e.improvement_gain, 0.7)

    def test_token_increase_ratio(self):
        e = self._experiment()
        self.assertAlmostEqual(e.token_increase_ratio, 1.5)

    def test_token_increase_ratio_zero_baseline(self):
        e = self._experiment(baseline_tokens=[0] * 10, candidate_tokens=[100] * 10)
        self.assertEqual(e.token_increase_ratio, float("inf"))

    def test_regression_rate(self):
        e = self._experiment(regression_trials=4, regression_failures=1)
        self.assertAlmostEqual(e.regression_rate, 0.25)

    def test_experiment_dict_roundtrip_preserves_enum(self):
        e = self._experiment()
        e.status = ExperimentStatus.PROMOTE
        data = e.to_dict()
        self.assertEqual(data["status"], "PROMOTE")
        restored = Experiment.from_dict(data)
        self.assertEqual(restored.status, ExperimentStatus.PROMOTE)
        self.assertIsInstance(restored.status, ExperimentStatus)
        # (str, Enum) members compare equal to their plain string value too
        self.assertEqual(restored.status, "PROMOTE")


if __name__ == "__main__":
    unittest.main()
