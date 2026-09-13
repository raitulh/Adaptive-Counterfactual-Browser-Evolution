"""
The full self-improvement loop: fail, diagnose, generate counterfactuals,
rank them, experiment, promote (or reject), store in memory, and transfer
the winning strategy to new, never-seen "websites".

    python -m examples.self_improve_example
"""

import asyncio
import tempfile
from pathlib import Path

from acbe.core.config import ACBEConfig
from acbe.memory.sqlite_store import SQLiteStrategyMemory
from acbe.self_improvement.loop import SelfImprovementLoop
from benchmarks.tasks import wrong_element_family, wrong_element_regression_family


async def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        config = ACBEConfig(
            db_path=str(Path(tmp) / "acbe.db"),
            promotion_min_sample_size=8,
            promotion_max_token_increase_ratio=10.0,  # see benchmarks/run_benchmark.py for why
        )
        memory = SQLiteStrategyMemory(config.db_path)
        loop = SelfImprovementLoop(memory=memory, config=config)

        training_tasks = wrong_element_family(10)
        regression_tasks = wrong_element_regression_family(4)

        print("=== First encounter: shop-0 (WRONG_ELEMENT trap) ===")
        outcome = await loop.run_and_improve(
            training_tasks[0], replay_variants=training_tasks, regression_tasks=regression_tasks,
        )
        print(f"success (naive attempt): {outcome.success}")
        imp = outcome.improvement
        print(f"failure_type:  {imp.fingerprint.failure_type}")
        print(f"root cause:    {imp.root_cause.likely_cause}")
        print(f"top candidate: {imp.top_candidate.actions[0]['locator_strategy']}")
        print(f"experiment:    {imp.experiment.status.value} ({imp.experiment.decision_reason})")
        print(f"promoted:      {imp.promoted_strategy is not None}\n")

        print("=== Cross-task transfer: three brand-new shops ===")
        transfer_tasks = wrong_element_family(3)
        for i, t in enumerate(transfer_tasks):
            t.task_id = f"new_shop_{i}"
            result = await loop.run_and_improve(t)
            print(f"  {t.task_id}: success={result.success}  "
                  f"used_transferred_strategy={result.used_transfer_strategy is not None}")

        print(f"\nLoop summary: {loop.summary()}")


if __name__ == "__main__":
    asyncio.run(main())
