import unittest

from acbe.experiments.runner import run_episode
from acbe.failure.fingerprint import FailureFingerprintBuilder
from benchmarks.tasks import (
    context_failure_family,
    dynamic_ui_family,
    missing_information_family,
    navigation_failure_family,
    verification_failure_family,
    wrong_element_family,
    wrong_element_regression_family,
    wrong_sequence_family,
)


class TestSyntheticFailureFamilies(unittest.IsolatedAsyncioTestCase):
    async def _assert_family_fails_as(self, family_tasks, expected_type):
        task = family_tasks[0]
        result = await run_episode(task, task.baseline_locator)
        self.assertFalse(result.success, msg=f"{task.task_id} was expected to fail with the naive strategy")
        fp = FailureFingerprintBuilder.from_episode_result(
            task_id=task.task_id, environment_id=task.environment.env_id, result=result,
        )
        self.assertEqual(fp.failure_type, expected_type)
        return fp

    async def test_wrong_click(self):
        await self._assert_family_fails_as(wrong_element_family(), "WRONG_ELEMENT")

    async def test_wrong_sequence(self):
        await self._assert_family_fails_as(wrong_sequence_family(), "WRONG_SEQUENCE")

    async def test_dynamic_ui(self):
        await self._assert_family_fails_as(dynamic_ui_family(), "STATE_MISUNDERSTANDING")

    async def test_missing_element_precondition(self):
        await self._assert_family_fails_as(missing_information_family(), "MISSING_INFORMATION")

    async def test_unexpected_popup(self):
        await self._assert_family_fails_as(context_failure_family(), "CONTEXT_FAILURE")

    async def test_navigation_failure(self):
        await self._assert_family_fails_as(navigation_failure_family(), "ENVIRONMENT_FAILURE")

    async def test_verification_failure(self):
        await self._assert_family_fails_as(verification_failure_family(), "VERIFICATION_FAILURE")

    async def test_stale_page_state(self):
        # Modeled as an auto-expiring page (Section 28's "stale DOM" scenario):
        # the environment changes state independently of the agent's action.
        from acbe.browser.mock_adapter import ElementSpec, EnvironmentSpec, PageSpec
        from acbe.core.types import ActionType, LocatorStrategy
        from acbe.experiments.runner import Task, TaskStep

        page = PageSpec(
            page_id="session", page_type="session",
            elements=[ElementSpec("submit_btn", "button", "Submit form", "Submit")],
            auto_expires_after=1, expired_page_id="expired",
        )
        expired = PageSpec(page_id="expired", page_type="expired", elements=[])
        env = EnvironmentSpec(env_id="stale-1", start_page="session",
                               pages={"session": page, "expired": expired}, goal_state="page:session")
        task = Task(
            task_id="stale_dom_0", description="Submit the form.", category="stale_dom",
            environment=env, steps=[TaskStep(ActionType.CLICK, "Submit form"),
                                     TaskStep(ActionType.CLICK, "Submit form")],
            goal_verification="page:session", baseline_locator=LocatorStrategy.TEXT_VISUAL,
        )
        result = await run_episode(task, task.baseline_locator)
        self.assertFalse(result.success)
        fp = FailureFingerprintBuilder.from_episode_result(
            task_id=task.task_id, environment_id=env.env_id, result=result,
        )
        self.assertEqual(fp.failure_type, "PAGE_CHANGED")

    async def test_regression_suite_succeeds_with_naive_strategy(self):
        task = wrong_element_regression_family(1)[0]
        result = await run_episode(task, task.baseline_locator)
        self.assertTrue(result.success)

    async def test_working_navigation_link_succeeds(self):
        from acbe.core.types import LocatorStrategy
        from acbe.experiments.runner import Task, TaskStep
        from acbe.core.types import ActionType
        from benchmarks.environments import make_navigation_environment

        env = make_navigation_environment("nav-ok-test", broken=False)
        task = Task(task_id="nav_ok_test", description="Go to support.", category="navigation",
                    environment=env, steps=[TaskStep(ActionType.CLICK, "Go to support center")],
                    goal_verification=env.goal_state, baseline_locator=LocatorStrategy.ROLE_NAME)
        result = await run_episode(task, task.baseline_locator)
        self.assertTrue(result.success)


if __name__ == "__main__":
    unittest.main()
