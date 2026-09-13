import unittest

from acbe.experiments.runner import run_episode
from acbe.failure.fingerprint import FailureFingerprintBuilder
from acbe.failure.taxonomy import FailureTaxonomy
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


class TestFailureTaxonomy(unittest.TestCase):
    def test_known_categories_present(self):
        tax = FailureTaxonomy()
        for name in ["WRONG_ELEMENT", "WRONG_SEQUENCE", "VERIFICATION_FAILURE", "TOKEN_BUDGET_FAILURE"]:
            self.assertTrue(tax.is_known(name))

    def test_cannot_silently_redefine_existing_category(self):
        tax = FailureTaxonomy()
        with self.assertRaises(ValueError):
            tax.register("WRONG_ELEMENT", "a totally different meaning")

    def test_can_register_new_category_additively(self):
        tax = FailureTaxonomy()
        tax.register("CUSTOM_FAILURE", "a project-specific category")
        self.assertTrue(tax.is_known("CUSTOM_FAILURE"))

    def test_deprecate_marks_without_removing(self):
        tax = FailureTaxonomy()
        tax.deprecate("TOOL_FAILURE")
        self.assertTrue(tax.is_known("TOOL_FAILURE"))
        self.assertIn("TOOL_FAILURE", tax._deprecated)


class TestFailureFingerprintBuilder(unittest.IsolatedAsyncioTestCase):
    async def test_builds_fingerprint_from_exception(self):
        task = wrong_element_family(1)[0]
        result = await run_episode(task, task.baseline_locator)
        self.assertFalse(result.success)
        fp = FailureFingerprintBuilder.from_episode_result(
            task_id=task.task_id, environment_id=task.environment.env_id, result=result,
        )
        self.assertEqual(fp.failure_type, "WRONG_ELEMENT")
        self.assertEqual(fp.task_id, task.task_id)
        self.assertTrue(fp.error)
        self.assertGreater(fp.token_cost, 0)

    async def test_no_fingerprint_needed_on_success(self):
        task = wrong_element_regression_family(1)[0]
        result = await run_episode(task, task.baseline_locator)
        self.assertTrue(result.success)


if __name__ == "__main__":
    unittest.main()
