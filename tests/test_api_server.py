import asyncio
import tempfile
import unittest
from pathlib import Path

from acbe.api.server import create_app
from acbe.core.config import ACBEConfig
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.loop import SelfImprovementLoop
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


class TestDashboardAPI(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.db = str(Path(self._tmp.name) / "acbe.db")

        config = ACBEConfig(db_path=self.db, promotion_min_sample_size=8, promotion_max_token_increase_ratio=10.0)
        memory = SQLiteStrategyMemory(self.db)
        loop = SelfImprovementLoop(memory=memory, config=config)
        training = wrong_element_family(10)
        regression = wrong_element_regression_family(4)
        asyncio.run(loop.run_and_improve(training[0], replay_variants=training, regression_tasks=regression))

        self.app = create_app(self.db)
        self.client = self.app.test_client()

    def tearDown(self):
        self._tmp.cleanup()

    def test_index_serves_html(self):
        res = self.client.get("/")
        self.assertEqual(res.status_code, 200)
        self.assertIn(b"ACBE", res.data)

    def test_overview_reports_promoted_strategy(self):
        res = self.client.get("/api/overview")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["strategies_promoted"], 1)
        self.assertGreaterEqual(data["experiments_promoted"], 1)
        self.assertIn("WRONG_ELEMENT", data["failures_by_type"])

    def test_failures_endpoint(self):
        res = self.client.get("/api/failures")
        data = res.get_json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["failure_type"], "WRONG_ELEMENT")

    def test_strategies_endpoint(self):
        res = self.client.get("/api/strategies")
        data = res.get_json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["lifecycle"], "PROMOTED")

    def test_experiments_endpoint(self):
        res = self.client.get("/api/experiments")
        data = res.get_json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["status"], "PROMOTE")

    def test_memory_search_filters_by_pattern(self):
        res = self.client.get("/api/memory/search?q=wrong_element")
        self.assertEqual(len(res.get_json()), 1)
        res_empty = self.client.get("/api/memory/search?q=nonexistent_pattern_xyz")
        self.assertEqual(len(res_empty.get_json()), 0)

    def test_versions_endpoint(self):
        res = self.client.get("/api/versions?kind=strategy")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.get_json()), 1)

    def test_tasks_list_endpoint(self):
        res = self.client.get("/api/tasks")
        self.assertEqual(res.status_code, 200)
        tasks = res.get_json()
        self.assertGreaterEqual(len(tasks), 20)
        self.assertTrue(any(t["task_id"] == "wrong_element_0" for t in tasks))

    def test_tasks_run_endpoint(self):
        res = self.client.post("/api/tasks/run", json={"task_id": "wrong_element_0"})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["task_id"], "wrong_element_0")
        self.assertFalse(data["success"])
        self.assertGreater(len(data["steps"]), 0)

    def test_tasks_rollback_endpoint(self):
        res = self.client.post("/api/rollback", json={"kind": "agent", "version": "agent-v1", "reason": "test"})
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["success"])

    def test_evolution_tree_endpoint(self):
        res = self.client.get("/api/evolution/tree")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("active_agent", data)
        self.assertIn("agent_versions", data)
        self.assertIn("strategy_versions", data)

    def test_benchmarks_results_endpoint(self):
        res = self.client.get("/api/benchmarks/results")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["suite_name"], "ACBE-Bench")
        self.assertIn("category_breakdown", data)

    def test_llm_status_endpoint(self):
        res = self.client.get("/api/llm/status")
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data["provider"], "Google Gemini")
        self.assertIn("supported_models", data)


if __name__ == "__main__":
    unittest.main()

