"""
Shows the two ways to plug in "a custom Python agent" (Section 2):

  1. ``FunctionAgent`` -- wrap any plain callable.
  2. ``ScriptedAgent``  -- replay a fixed step list (useful as a template
     for wiring in a real LLM-backed planner: swap ``plan()`` for a call
     into ``acbe.adapters.OllamaAdapter`` / ``OpenAICompatibleAdapter``).

    python -m examples.custom_agent_example
"""

import asyncio

from acbe.agents.custom_agent import FunctionAgent, ScriptedAgent
from acbe.core.executor import run_agent_episode
from acbe.core.types import ActionRecord, ActionType, LocatorStrategy, new_id
from acbe.experiments.runner import TaskStep
from benchmarks.environments import make_shop_environment


def naive_plan(goal, observation, history):
    """A tiny rule-based planner: click whatever looks most relevant to the
    goal among the elements currently visible. This is intentionally naive
    (text-only matching) so it reproduces the WRONG_ELEMENT failure the
    self-improvement loop is designed to recover from."""
    if not history:
        target = "Browse products" if "Browse products" in observation.visible_elements else observation.visible_elements[0]
    elif len(history) == 1:
        target = "Add to cart"
    else:
        target = "Proceed to checkout"
    return ActionRecord(
        action_id=new_id("act"), action_type=ActionType.CLICK,
        target_description=target, locator_strategy=LocatorStrategy.TEXT_VISUAL,
    )


async def main() -> None:
    env = make_shop_environment("function-agent-shop", trap=True)

    print("=== FunctionAgent (plain callable) ===")
    agent = FunctionAgent(naive_plan)
    result = await run_agent_episode(
        agent=agent, environment=env, goal="Add a product to the cart and check out.",
        goal_verification=env.goal_state,
    )
    print(f"success={result.success}  steps={len(result.trajectory.steps)}")
    if not result.success:
        print(f"  -> {result.error}")

    print("\n=== ScriptedAgent (fixed step list, robust locator) ===")
    env2 = make_shop_environment("scripted-agent-shop", trap=True)
    steps = [
        TaskStep(ActionType.CLICK, "Browse products"),
        TaskStep(ActionType.CLICK, "Add to cart"),
        TaskStep(ActionType.CLICK, "Proceed to checkout"),
    ]
    agent2 = ScriptedAgent(steps, locator_strategy=LocatorStrategy.ROLE_NAME)
    result2 = await run_agent_episode(
        agent=agent2, environment=env2, goal="Add a product to the cart and check out.",
        goal_verification=env2.goal_state,
    )
    print(f"success={result2.success}  steps={len(result2.trajectory.steps)}")


if __name__ == "__main__":
    asyncio.run(main())
