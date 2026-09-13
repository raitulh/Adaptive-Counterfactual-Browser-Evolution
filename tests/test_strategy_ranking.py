import unittest

from acbe.core.config import ACBEConfig
from acbe.counterfactual.generator import CounterfactualGenerator
from acbe.failure.fingerprint import FailureFingerprint
from acbe.strategy.models import Strategy
from acbe.strategy.ranking import cheap_score, deterministic_filter, rank_candidates


def make_fingerprint(failure_type="WRONG_ELEMENT") -> FailureFingerprint:
    return FailureFingerprint(
        fingerprint_id="f1", task_id="t1", step_id="s1", action="click:X",
        expected_state="", actual_state="", ui_state_hash="", error="boom",
        failure_type=failure_type, uncertainty=0.4,
    )


class TestDeterministicFilter(unittest.TestCase):
    def test_dedups_structurally_identical_strategies(self):
        s1 = Strategy.new("WRONG_ELEMENT", "role_name")
        s2 = Strategy.new("WRONG_ELEMENT", "role_name")  # identical shape
        s3 = Strategy.new("WRONG_ELEMENT", "dom_role")
        kept = deterministic_filter([s1, s2, s3], keep=10)
        self.assertEqual(len(kept), 2)

    def test_respects_keep_limit(self):
        strategies = [Strategy.new("WRONG_ELEMENT", loc) for loc in
                       ["role_name", "dom_role", "semantic_search", "nearby_element"]]
        kept = deterministic_filter(strategies, keep=2)
        self.assertEqual(len(kept), 2)


class TestRankingFunnel(unittest.TestCase):
    def test_funnel_sizes_are_respected(self):
        config = ACBEConfig(funnel_deterministic_keep=6, funnel_cheap_keep=3, funnel_small_model_keep=2)
        candidates = CounterfactualGenerator().generate(make_fingerprint("WRONG_ELEMENT"))
        survivors = rank_candidates(candidates, config)
        self.assertLessEqual(len(survivors), 2)
        self.assertGreaterEqual(len(survivors), 1)

    def test_text_visual_never_wins_a_wrong_element_ranking(self):
        # text_visual isn't even generated as a candidate for WRONG_ELEMENT
        # (see test_counterfactual.py), but assert the invariant at the
        # ranking layer too in case that ever changes upstream.
        config = ACBEConfig()
        candidates = CounterfactualGenerator().generate(make_fingerprint("WRONG_ELEMENT"))
        survivors = rank_candidates(candidates, config)
        winner_locator = survivors[0].actions[0]["locator_strategy"]
        self.assertNotEqual(winner_locator, "text_visual")

    def test_higher_risk_strategy_scores_lower_all_else_equal(self):
        config = ACBEConfig()
        safe = Strategy.new("WRONG_ELEMENT", "role_name", risk=0.1)
        risky = Strategy.new("WRONG_ELEMENT", "role_name", risk=0.9)
        self.assertGreater(cheap_score(safe, config), cheap_score(risky, config))

    def test_custom_small_model_scorer_is_used(self):
        config = ACBEConfig(funnel_small_model_keep=1)
        candidates = CounterfactualGenerator().generate(make_fingerprint("WRONG_ELEMENT"))
        # a scorer that always prefers dom_role, regardless of the default heuristic
        def prefer_dom_role(candidate):
            return 1.0 if candidate.actions[0].get("locator_strategy") == "dom_role" else 0.0

        survivors = rank_candidates(candidates, config, small_model_scorer=prefer_dom_role)
        self.assertEqual(survivors[0].actions[0]["locator_strategy"], "dom_role")


if __name__ == "__main__":
    unittest.main()
