import tempfile
import unittest
from pathlib import Path

from acbe import ACBE
from acbe.agents.custom_agent import FunctionAgent, ScriptedAgent
from acbe.core.types import ActionType, LocatorStrategy, new_id
from acbe.experiments.runner import TaskStep
from benchmarks.environments import make_shop_environment
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


def naive_shop_plan(goal, observation, history):
    if not history:
        target = "Browse products"
    elif len(history) == 1:
        target = "Add to cart"
    else:
        target = "Proceed to checkout"
    return {
        "action_id": new_id("act"), "action_type": ActionType.CLICK,
        "target_description": target, "locator_strategy": LocatorStrategy.TEXT_VISUAL,
    }


class TestACBETaskBased(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self._tmp.name) / "acbe.db")

    def tearDown(self):
        self._tmp.cleanup()

    def test_wrap_classmethod(self):
        agent = ScriptedAgent([])
        system = ACBE.wrap(agent, db_path=self.db)
        self.assertIs(system.agent, agent)

    def test_run_task_object_naive_fails(self):
        task = wrong_element_family(1)[0]
        system = ACBE(memory=False, self_improvement=False, db_path=self.db)
        result = system.run(task)
        self.assertFalse(result.success)
        self.assertGreater(result.tokens_used, 0)

    def test_run_and_improve_task_object_promotes(self):
        tasks = wrong_element_family(10)
        regression = wrong_element_regression_family(4)
        system = ACBE(db_path=self.db)
        system.config.promotion_min_sample_size = 8
        system.config.promotion_max_token_increase_ratio = 10.0
        system.loop.config = system.config
        system.loop.promotion_gate.config = system.config

        result = system.run_and_improve(tasks[0], replay_variants=tasks, regression_tasks=regression)
        self.assertFalse(result.success)  # naive first attempt
        self.assertTrue(result.improvement_triggered)
        self.assertEqual(result.improvement_result["experiment_status"], "PROMOTE")
        self.assertTrue(result.improvement_result["promoted"])

        summary = system.summary()
        self.assertEqual(summary["verified_improvements"], 1)

    def test_self_improvement_disabled_returns_plain_run(self):
        task = wrong_element_family(1)[0]
        system = ACBE(memory=False, self_improvement=False, db_path=self.db)
        result = system.run_and_improve(task)
        self.assertFalse(result.success)
        self.assertFalse(result.improvement_triggered)


class TestACBEFreeText(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self._tmp.name) / "acbe.db")

    def tearDown(self):
        self._tmp.cleanup()

    def test_free_text_requires_agent(self):
        env = make_shop_environment("no-agent-shop")
        system = ACBE(browser="mock", environment=env, db_path=self.db)
        with self.assertRaises(ValueError):
            system.run("do something")

    def test_free_text_requires_environment(self):
        agent = FunctionAgent(naive_shop_plan)
        system = ACBE(agent=agent, browser="mock", db_path=self.db)
        with self.assertRaises(ValueError):
            system.run("do something")

    def test_free_text_naive_agent_fails_on_trap(self):
        env = make_shop_environment("free-text-shop", trap=True)
        agent = FunctionAgent(naive_shop_plan)
        system = ACBE(agent=agent, browser="mock", environment=env, db_path=self.db)
        result = system.run("Add a product to the cart and check out.")
        self.assertFalse(result.success)

    def test_free_text_run_and_improve_recovers_via_replay(self):
        env = make_shop_environment("free-text-shop-2", trap=True)
        agent = FunctionAgent(naive_shop_plan)
        system = ACBE(agent=agent, browser="mock", environment=env, db_path=self.db)
        system.config.promotion_min_sample_size = 1
        system.config.promotion_max_token_increase_ratio = 10.0
        system.loop.promotion_gate.config = system.config

        result = system.run_and_improve("Add a product to the cart and check out.")
        self.assertFalse(result.success)
        self.assertTrue(result.improvement_triggered)
        self.assertIn(result.improvement_result["experiment_status"], ("PROMOTE", "NEEDS_MORE_DATA", "REJECT"))

    def test_scripted_agent_free_text_succeeds(self):
        env = make_shop_environment("free-text-shop-3", trap=True)
        steps = [
            TaskStep(ActionType.CLICK, "Browse products"),
            TaskStep(ActionType.CLICK, "Add to cart"),
            TaskStep(ActionType.CLICK, "Proceed to checkout"),
        ]
        agent = ScriptedAgent(steps, locator_strategy=LocatorStrategy.ROLE_NAME)
        system = ACBE(agent=agent, browser="mock", environment=env, db_path=self.db)
        result = system.run("Add a product to the cart and check out.")
        self.assertTrue(result.success)


if __name__ == "__main__":
    unittest.main()
