import tempfile
import unittest
from pathlib import Path

from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.transfer import CrossTaskTransfer
from acbe.strategy.models import Strategy, StrategyLifecycle


class TestCrossTaskTransfer(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.memory = SQLiteStrategyMemory(str(Path(self._tmp.name) / "t.db"))
        self.transfer = CrossTaskTransfer(self.memory)

    async def asyncTearDown(self):
        self._tmp.cleanup()

    async def test_find_transferable_only_returns_validated_strategies(self):
        draft = Strategy.new("WRONG_ELEMENT", "role_name")  # still DRAFT
        promoted = Strategy.new("WRONG_ELEMENT", "dom_role")
        promoted.lifecycle = StrategyLifecycle.PROMOTED
        promoted.record_trial(success=True, token_cost=100, environment_id="shop-a")
        await self.memory.store(draft)
        await self.memory.store(promoted)

        results = await self.transfer.find_transferable("WRONG_ELEMENT", "shop-b")
        ids = {r.strategy_id for r in results}
        self.assertIn(promoted.strategy_id, ids)
        self.assertNotIn(draft.strategy_id, ids)

    def test_confidence_uses_full_success_rate_when_environment_already_seen(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        confidence = self.transfer.estimate_confidence(s, "shop-a")
        self.assertEqual(confidence, s.success_rate)

    def test_confidence_is_conservative_for_unseen_environment_with_no_transfer_history(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        # success_rate is 1.0 in shop-a, but it's never been transferred anywhere
        confidence = self.transfer.estimate_confidence(s, "shop-never-seen")
        self.assertLess(confidence, s.success_rate)

    async def test_apply_and_record_updates_transfer_statistics(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        await self.memory.store(s)

        await self.transfer.apply_and_record(s, "WRONG_ELEMENT", "shop-b", success=True, token_cost=120)
        self.assertEqual(s.transfer_trials, 1)
        self.assertEqual(s.transfer_successes, 1)
        self.assertEqual(self.transfer.transfer_success_rate, 1.0)

        stored = await self.memory.get(s.strategy_id)
        self.assertEqual(stored.transfer_trials, 1)

    async def test_apply_and_record_does_not_count_in_environment_reuse_as_transfer(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        s.record_trial(success=True, token_cost=100, environment_id="shop-a")
        await self.memory.store(s)

        await self.transfer.apply_and_record(s, "WRONG_ELEMENT", "shop-a", success=True, token_cost=100)
        self.assertEqual(s.transfer_trials, 0)  # shop-a was already seen -- not a transfer


if __name__ == "__main__":
    unittest.main()
