import tempfile
import unittest
from pathlib import Path

from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.strategy.models import Strategy, StrategyLifecycle


class TestSQLiteStrategyMemory(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self._tmp.name) / "test.db")
        self.memory = SQLiteStrategyMemory(self.db_path)

    async def asyncTearDown(self):
        self._tmp.cleanup()

    async def test_store_and_get_roundtrip(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        s.lifecycle = StrategyLifecycle.PROMOTED
        await self.memory.store(s)

        fetched = await self.memory.get(s.strategy_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.strategy_id, s.strategy_id)
        self.assertEqual(fetched.lifecycle, StrategyLifecycle.PROMOTED)

    async def test_retrieve_filters_by_failure_pattern(self):
        s1 = Strategy.new("WRONG_ELEMENT", "role_name")
        s2 = Strategy.new("WRONG_SEQUENCE", "role_name")
        await self.memory.store(s1)
        await self.memory.store(s2)

        results = await self.memory.retrieve("WRONG_ELEMENT")
        ids = {r.strategy_id for r in results}
        self.assertIn(s1.strategy_id, ids)
        self.assertNotIn(s2.strategy_id, ids)

    async def test_retrieve_biases_toward_seen_environment(self):
        s1 = Strategy.new("WRONG_ELEMENT", "role_name")
        s1.record_trial(success=True, token_cost=100, environment_id="shop-a")
        s2 = Strategy.new("WRONG_ELEMENT", "dom_role")
        s2.record_trial(success=True, token_cost=100, environment_id="shop-b")
        await self.memory.store(s1)
        await self.memory.store(s2)

        results = await self.memory.retrieve("WRONG_ELEMENT", environment_id="shop-a")
        self.assertEqual(results[0].strategy_id, s1.strategy_id)

    async def test_min_success_rate_filter(self):
        weak = Strategy.new("WRONG_ELEMENT", "role_name")
        weak.record_trial(success=False, token_cost=100, environment_id="e1")
        weak.record_trial(success=False, token_cost=100, environment_id="e1")
        strong = Strategy.new("WRONG_ELEMENT", "dom_role")
        strong.record_trial(success=True, token_cost=100, environment_id="e1")
        await self.memory.store(weak)
        await self.memory.store(strong)

        results = await self.memory.retrieve("WRONG_ELEMENT", min_success_rate=0.5)
        ids = {r.strategy_id for r in results}
        self.assertIn(strong.strategy_id, ids)
        self.assertNotIn(weak.strategy_id, ids)

    async def test_update_persists_new_stats(self):
        s = Strategy.new("WRONG_ELEMENT", "role_name")
        await self.memory.store(s)
        s.record_trial(success=True, token_cost=50, environment_id="e1")
        await self.memory.update(s)

        fetched = await self.memory.get(s.strategy_id)
        self.assertEqual(fetched.trials, 1)
        self.assertEqual(fetched.successes, 1)

    async def test_list_all(self):
        await self.memory.store(Strategy.new("WRONG_ELEMENT", "role_name"))
        await self.memory.store(Strategy.new("WRONG_SEQUENCE", "dom_role"))
        all_strategies = await self.memory.list_all()
        self.assertEqual(len(all_strategies), 2)


if __name__ == "__main__":
    unittest.main()
