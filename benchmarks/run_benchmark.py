"""
Runs ACBE-Bench (Section 16/18): compares a naive baseline agent against the
full ACBE self-improvement loop, and reports whether the agent measurably
improves after experiencing verified failures -- the central benchmark
question from the self-improvement update, Section 16:

    "Does the agent actually become better after experiencing verified
    failures?"

Usage:
    python -m benchmarks.run_benchmark
"""

from __future__ import annotations

import asyncio
import statistics
import tempfile
from pathlib import Path
from typing import Dict, List

from acbe.core.config import ACBEConfig
from acbe.experiments.runner import Task, run_episode
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.loop import SelfImprovementLoop
from benchmarks.tasks import all_tasks, wrong_element_family, wrong_element_regression_family


async def run_baseline(tasks: List[Task]) -> Dict[str, float]:
    """Baseline Agent (Section 18): naive locator strategy, no memory, no
    improvement -- every task attempted exactly once."""
    successes, tokens = 0, []
    for task in tasks:
        result = await run_episode(task, task.baseline_locator, agent_version="baseline")
        successes += int(result.success)
        tokens.append(result.trajectory.total_tokens)
    n = len(tasks)
    return {
        "success_rate": successes / n if n else 0.0,
        "avg_tokens": statistics.mean(tokens) if tokens else 0.0,
    }


async def run_full_acbe() -> Dict[str, object]:
    """Full ACBE (Section 18): counterfactual generation, ranking,
    sandbox/replay experimentation, statistical promotion, and cross-task
    transfer, exactly as ``SelfImprovementLoop`` implements it."""
    with tempfile.TemporaryDirectory() as tmp:
        db_path = str(Path(tmp) / "bench.db")
        config = ACBEConfig(
            db_path=db_path,
            promotion_min_sample_size=8,
            # This demo compares a strategy that always fails early (few
            # tokens spent) against one that completes the task fully (more
            # tokens spent, because it actually finishes). That comparison
            # is about *correctness*, not cost, so the token-budget gate is
            # relaxed here; `tests/test_promotion_rollback.py` covers the
            # cost-rejection path with a controlled, comparable scenario.
            promotion_max_token_increase_ratio=10.0,
        )
        memory = SQLiteStrategyMemory(db_path)
        loop = SelfImprovementLoop(memory=memory, config=config)

        training_tasks = wrong_element_family(10)
        transfer_tasks = wrong_element_family(4)
        for t in transfer_tasks:
            t.task_id = "transfer_" + t.task_id
        regression_tasks = wrong_element_regression_family(4)

        first_task, replay_variants = training_tasks[0], training_tasks
        outcome = await loop.run_and_improve(
            first_task, replay_variants=replay_variants, regression_tasks=regression_tasks,
        )
        promoted = outcome.improvement is not None and outcome.improvement.promoted_strategy is not None

        transfer_successes = 0
        for t in transfer_tasks:
            r = await loop.run_and_improve(t)
            transfer_successes += int(r.success)

        return {
            "recovered_and_promoted_on_first_failure_family": promoted,
            "post_promotion_transfer_success_rate": transfer_successes / len(transfer_tasks),
            "loop_summary": loop.summary(),
        }


async def main() -> None:
    tasks = all_tasks()
    print(f"ACBE-Bench: {len(tasks)} synthetic tasks across "
          f"{len({t.category for t in tasks})} categories.")
    print("(Every task in this starter suite deliberately injects one specific failure\n"
          " mode -- it is an adversarial suite for exercising failure recovery, not a\n"
          " representative mix of easy/hard tasks. See research/methodology.md.)\n")

    baseline = await run_baseline(tasks)
    print("Baseline Agent (naive locator, no memory, no improvement):")
    print(f"  success_rate = {baseline['success_rate']:.2%}")
    print(f"  avg_tokens   = {baseline['avg_tokens']:.0f}\n")

    acbe_result = await run_full_acbe()
    print("Full ACBE (self-improvement loop, WRONG_ELEMENT family):")
    print(f"  recovered_and_promoted_on_first_failure_family = "
          f"{acbe_result['recovered_and_promoted_on_first_failure_family']}")
    print(f"  post_promotion_transfer_success_rate            = "
          f"{acbe_result['post_promotion_transfer_success_rate']:.2%}")
    print(f"  loop metrics: {acbe_result['loop_summary']}")


if __name__ == "__main__":
    asyncio.run(main())
