import unittest
from unittest.mock import MagicMock, patch

from acbe.agents.base import AgentFinished
from acbe.agents.custom_agent import FunctionAgent, ScriptedAgent
from acbe.core.executor import build_replay_task, run_agent_episode
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, new_id
from acbe.experiments.runner import STEPS_COMPLETE, TaskStep, run_episode
from benchmarks.environments import make_shop_environment


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


class TestFunctionAgent(unittest.IsolatedAsyncioTestCase):
    async def test_function_agent_fails_on_trap_with_naive_strategy(self):
        env = make_shop_environment("fn-agent-shop", trap=True)
        agent = FunctionAgent(naive_shop_plan)
        result = await run_agent_episode(agent=agent, environment=env,
                                          goal="add to cart", goal_verification=env.goal_state)
        self.assertFalse(result.success)
        self.assertIsNotNone(result.error)

    async def test_function_agent_can_return_action_record_directly(self):
        env = make_shop_environment("fn-agent-shop-2", trap=False)

        def plan(goal, observation, history):
            if history:
                raise AgentFinished()
            return ActionRecord(action_id=new_id("act"), action_type=ActionType.CLICK,
                                 target_description="Browse products", locator_strategy=LocatorStrategy.ROLE_NAME)

        agent = FunctionAgent(plan)
        result = await run_agent_episode(agent=agent, environment=env, goal="browse", goal_verification="page:product")
        self.assertTrue(result.success)


class TestScriptedAgent(unittest.IsolatedAsyncioTestCase):
    async def test_scripted_agent_completes_full_flow_with_robust_locator(self):
        env = make_shop_environment("scripted-shop", trap=True)
        steps = [
            TaskStep(ActionType.CLICK, "Browse products"),
            TaskStep(ActionType.CLICK, "Add to cart"),
            TaskStep(ActionType.CLICK, "Proceed to checkout"),
        ]
        agent = ScriptedAgent(steps, locator_strategy=LocatorStrategy.ROLE_NAME)
        result = await run_agent_episode(agent=agent, environment=env, goal="checkout", goal_verification=env.goal_state)
        self.assertTrue(result.success)

    async def test_scripted_agent_raises_stop_iteration_when_exhausted(self):
        env = make_shop_environment("scripted-shop-2", trap=False)
        agent = ScriptedAgent([TaskStep(ActionType.CLICK, "Browse products")])
        result = await run_agent_episode(agent=agent, environment=env, goal="browse",
                                          goal_verification="page:this-is-never-reached", max_steps=5)
        # agent runs out of steps without reaching the (impossible) goal
        self.assertFalse(result.success)


class TestReplayTaskBridge(unittest.IsolatedAsyncioTestCase):
    async def test_recorded_agent_run_can_be_replayed_with_a_different_locator(self):
        env = make_shop_environment("replay-shop", trap=True)
        agent = FunctionAgent(naive_shop_plan)
        result = await run_agent_episode(agent=agent, environment=env, goal="checkout", goal_verification=env.goal_state)
        self.assertFalse(result.success)  # naive strategy hits the trap

        replay_task = build_replay_task(
            task_id="replay-1", goal="checkout", category="agent_recorded", environment=env,
            recorded_steps=result.recorded_steps, goal_verification=STEPS_COMPLETE,
            baseline_locator=LocatorStrategy.TEXT_VISUAL,
        )
        # replay the exact same recorded target descriptions, but with a robust locator
        replayed = await run_episode(replay_task, LocatorStrategy.ROLE_NAME)
        self.assertTrue(replayed.success)


class TestModelAdapters(unittest.IsolatedAsyncioTestCase):
    @patch("requests.post")
    async def test_ollama_adapter_parses_response(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "message": {"content": "click the button"},
            "prompt_eval_count": 120, "eval_count": 30,
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        from acbe.adapters.ollama_adapter import OllamaAdapter
        adapter = OllamaAdapter(model="qwen2.5:7b")
        response = await adapter.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(response.content, "click the button")
        self.assertEqual(response.input_tokens, 120)
        self.assertEqual(response.output_tokens, 30)

    @patch("requests.post")
    async def test_openai_compatible_adapter_parses_response(self, mock_post):
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "choices": [{"message": {"content": "ok"}}],
            "usage": {"prompt_tokens": 50, "completion_tokens": 10},
        }
        mock_response.raise_for_status = MagicMock()
        mock_post.return_value = mock_response

        from acbe.adapters.openai_compatible_adapter import OpenAICompatibleAdapter
        adapter = OpenAICompatibleAdapter(model="gpt-x", api_key="sk-test")
        response = await adapter.chat([{"role": "user", "content": "hi"}])
        self.assertEqual(response.content, "ok")
        self.assertEqual(response.input_tokens, 50)

    @patch("acbe.adapters.gemini_adapter.GeminiAdapter._call_gemini_rest")
    async def test_gemini_adapter_chat_and_diagnosis(self, mock_rest):
        mock_rest.return_value = {
            "candidates": [{
                "content": {"parts": [{"text": '{"failure_type": "WRONG_ELEMENT", "recommended_locator": "dom_role", "reasoning": "Scoped accessibility tree avoids visual trap."}'}]}
            }],
            "usageMetadata": {"promptTokenCount": 150, "candidatesTokenCount": 50}
        }
        from acbe.adapters.gemini_adapter import GeminiAdapter
        adapter = GeminiAdapter(api_key="mock-key", model="gemini-flash-latest")
        self.assertTrue(adapter.is_available)

        # Test chat
        res = await adapter.chat([{"role": "user", "content": "hello"}])
        self.assertIn("WRONG_ELEMENT", res.content)
        self.assertEqual(res.input_tokens, 150)

        # Test diagnosis
        diag = adapter.diagnose_failure("WRONG_ELEMENT", "Buy product", "Add button", "Clicked look-alike")
        self.assertEqual(diag["recommended_locator"], "dom_role")
        self.assertTrue(diag["live_gemini"])


if __name__ == "__main__":
    unittest.main()
