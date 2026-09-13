import unittest

from acbe.evaluation.evaluator import EvaluationResult, Evaluator
from acbe.experiments.runner import run_episode
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


class TestEvaluator(unittest.IsolatedAsyncioTestCase):
    async def test_success_is_evaluated_as_complete(self):
        task = wrong_element_regression_family(1)[0]
        result = await run_episode(task, task.baseline_locator)
        evaluation = Evaluator().evaluate(result.trajectory)
        self.assertTrue(evaluation.completed)
        self.assertEqual(evaluation.severity, 0.0)

    async def test_failure_identifies_earliest_failed_step(self):
        task = wrong_element_family(1)[0]
        result = await run_episode(task, task.baseline_locator)
        evaluation = Evaluator().evaluate(result.trajectory)
        self.assertFalse(evaluation.completed)
        self.assertIsNotNone(evaluation.earliest_failure_step_id)
        # the failed step really is in the trajectory
        step_ids = [s.step_id for s in result.trajectory.steps]
        self.assertIn(evaluation.earliest_failure_step_id, step_ids)

    def test_llm_judge_used_only_as_fallback(self):
        called = {"n": 0}

        def fake_judge(trajectory):
            called["n"] += 1
            return EvaluationResult(trajectory_id=trajectory.trajectory_id, completed=False, method="llm_judge")

        evaluator = Evaluator(llm_judge=fake_judge)
        # a trajectory marked unsuccessful with no failed step at all
        from acbe.core.types import Trajectory
        traj = Trajectory(trajectory_id="t1", task_id="t", task_description="d",
                           environment_id="e", agent_version="v1", strategy_version="s1")
        traj.success = False
        result = evaluator.evaluate(traj)
        self.assertEqual(called["n"], 1)
        self.assertEqual(result.method, "llm_judge")

    def test_evaluator_never_takes_the_agent_as_input(self):
        import inspect
        sig = inspect.signature(Evaluator.evaluate)
        params = list(sig.parameters)
        self.assertEqual(params, ["self", "trajectory"])


if __name__ == "__main__":
    unittest.main()
