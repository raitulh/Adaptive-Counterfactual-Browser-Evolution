import unittest

from acbe.core.config import ACBEConfig
from acbe.efficiency.router import ModelRouter, ModelTier, ObservationDepth
from acbe.efficiency.token_tracker import TokenTracker


class TestTokenTracker(unittest.TestCase):
    def test_totals_and_cost(self):
        t = TokenTracker()
        t.record_call("large", input_tokens=1000, output_tokens=200, latency_ms=50)
        t.record_call("small", input_tokens=500, output_tokens=100, latency_ms=20)
        self.assertEqual(t.total_input_tokens, 1500)
        self.assertEqual(t.total_output_tokens, 300)
        self.assertEqual(t.total_tokens, 1800)
        self.assertGreater(t.estimated_cost_usd, 0)

    def test_cache_hits_are_free_and_excluded_from_model_calls(self):
        t = TokenTracker()
        t.record_call("large", input_tokens=1000, output_tokens=200, cache_hit=True)
        self.assertEqual(t.total_model_calls, 0)
        self.assertEqual(t.estimated_cost_usd, 0.0)
        self.assertEqual(t.cache_hit_rate, 1.0)

    def test_summary_shape(self):
        t = TokenTracker()
        t.record_screenshot()
        t.record_dom_observation()
        t.record_dedup_skip()
        summary = t.summary()
        self.assertIn("total_tokens", summary)
        self.assertEqual(summary["screenshots_taken"], 1)
        self.assertEqual(summary["observations_skipped_dedup"], 1)


class TestModelRouter(unittest.TestCase):
    def setUp(self):
        self.router = ModelRouter(ACBEConfig())

    def test_cached_validated_strategy_is_deterministic_and_cheap(self):
        decision = self.router.route(uncertainty=0.1, has_validated_strategy=True)
        self.assertEqual(decision.tier, ModelTier.DETERMINISTIC)
        self.assertEqual(decision.observation_depth, ObservationDepth.MINIMAL)

    def test_repeated_failure_escalates_to_large_model(self):
        decision = self.router.route(uncertainty=0.2, has_validated_strategy=False, repeated_failure_count=2)
        self.assertEqual(decision.tier, ModelTier.LARGE)
        self.assertEqual(decision.reasoning_mode, "counterfactual")

    def test_high_confidence_uses_small_model(self):
        decision = self.router.route(uncertainty=0.05, has_validated_strategy=False)
        self.assertEqual(decision.tier, ModelTier.SMALL)

    def test_low_confidence_uses_large_model(self):
        decision = self.router.route(uncertainty=0.9, has_validated_strategy=False)
        self.assertEqual(decision.tier, ModelTier.LARGE)

    def test_unchanged_state_prefers_minimal_observation(self):
        decision = self.router.route(uncertainty=0.05, has_validated_strategy=False, state_changed=False)
        self.assertEqual(decision.observation_depth, ObservationDepth.MINIMAL)


if __name__ == "__main__":
    unittest.main()
