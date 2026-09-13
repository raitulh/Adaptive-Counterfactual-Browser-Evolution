import unittest

from acbe.core.types import LocatorStrategy
from acbe.experiments.runner import ExperimentRunner
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


class TestExperimentRunner(unittest.IsolatedAsyncioTestCase):
    async def test_ab_test_shows_candidate_beats_baseline(self):
        tasks = wrong_element_family(6)
        regression = wrong_element_regression_family(3)
        runner = ExperimentRunner()
        experiment = await runner.run(
            experiment_id="exp1", baseline_version="baseline", candidate_version="candidate",
            strategy_id="role_name", task_set=tasks,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, candidate_locator=LocatorStrategy.ROLE_NAME,
            regression_task_set=regression,
        )
        self.assertEqual(experiment.baseline_trials, 6)
        self.assertEqual(experiment.candidate_trials, 6)
        self.assertEqual(experiment.baseline_successes, 0)   # every task has a trap
        self.assertEqual(experiment.candidate_successes, 6)  # role_name sees through it
        self.assertEqual(experiment.regression_trials, 3)
        self.assertEqual(experiment.regression_failures, 0)  # no trap in the regression suite

    async def test_identical_locator_shows_no_improvement(self):
        tasks = wrong_element_family(4)
        runner = ExperimentRunner()
        experiment = await runner.run(
            experiment_id="exp2", baseline_version="baseline", candidate_version="candidate",
            strategy_id="text_visual", task_set=tasks,
            baseline_locator=LocatorStrategy.TEXT_VISUAL, candidate_locator=LocatorStrategy.TEXT_VISUAL,
        )
        self.assertEqual(experiment.improvement_gain, 0.0)


if __name__ == "__main__":
    unittest.main()
