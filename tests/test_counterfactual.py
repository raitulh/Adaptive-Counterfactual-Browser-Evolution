import unittest

from acbe.counterfactual.generator import CounterfactualGenerator
from acbe.failure.fingerprint import FailureFingerprint


def make_fingerprint(failure_type: str) -> FailureFingerprint:
    return FailureFingerprint(
        fingerprint_id="f1", task_id="t1", step_id="s1", action="click:X",
        expected_state="", actual_state="", ui_state_hash="", error="boom",
        failure_type=failure_type, uncertainty=0.4,
    )


class TestCounterfactualGenerator(unittest.TestCase):
    def setUp(self):
        self.gen = CounterfactualGenerator()

    def test_wrong_element_generates_six_distinct_candidates(self):
        candidates = self.gen.generate(make_fingerprint("WRONG_ELEMENT"))
        self.assertEqual(len(candidates), 6)
        locators = {c.actions[0]["locator_strategy"] for c in candidates}
        self.assertEqual(len(locators), 6)  # all structurally distinct
        for c in candidates:
            self.assertEqual(c.failure_pattern, "WRONG_ELEMENT")
            self.assertEqual(c.lifecycle.value, "DRAFT")

    def test_never_recommends_the_failed_strategy_again(self):
        # text_visual is what caused a WRONG_ELEMENT failure in this project's
        # benchmark; the generator should never propose it as the "fix".
        candidates = self.gen.generate(make_fingerprint("WRONG_ELEMENT"))
        locators = [c.actions[0]["locator_strategy"] for c in candidates]
        self.assertNotIn("text_visual", locators)

    def test_every_known_failure_type_produces_at_least_two_candidates(self):
        for failure_type in [
            "WRONG_ELEMENT", "WRONG_SEQUENCE", "STATE_MISUNDERSTANDING",
            "MISSING_INFORMATION", "PAGE_CHANGED", "CONTEXT_FAILURE",
            "ENVIRONMENT_FAILURE", "VERIFICATION_FAILURE",
        ]:
            candidates = self.gen.generate(make_fingerprint(failure_type))
            self.assertGreaterEqual(len(candidates), 2, msg=f"failure_type={failure_type}")

    def test_unknown_failure_type_falls_back_to_default_generator(self):
        candidates = self.gen.generate(make_fingerprint("SOME_UNSEEN_CATEGORY"))
        self.assertGreaterEqual(len(candidates), 2)

    def test_candidates_have_required_strategy_fields(self):
        for c in self.gen.generate(make_fingerprint("WRONG_ELEMENT")):
            self.assertTrue(c.strategy_id)
            self.assertIsInstance(c.actions, list)
            self.assertGreaterEqual(len(c.actions), 1)
            self.assertIsInstance(c.risk, float)


if __name__ == "__main__":
    unittest.main()
