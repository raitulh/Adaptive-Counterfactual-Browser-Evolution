"""
Basic usage: run one bundled benchmark task through ACBE without any
self-improvement (a plain, single-attempt execution).

    python -m examples.basic_usage
"""

import asyncio

from acbe.core.types import LocatorStrategy
from acbe.experiments.runner import run_episode
from benchmarks.tasks import wrong_element_family


async def main() -> None:
    task = wrong_element_family(1)[0]

    print(f"Task: {task.description}")
    print(f"Environment: {task.environment.env_id} ({task.category})\n")

    result = await run_episode(task, LocatorStrategy.TEXT_VISUAL)
    print(f"[naive text/visual locator]  success={result.success}  "
          f"steps={len(result.trajectory.steps)}  tokens={result.trajectory.total_tokens}")
    if not result.success and result.error:
        print(f"  -> failed because: {result.error}")

    result = await run_episode(task, LocatorStrategy.ROLE_NAME)
    print(f"[role+accessible-name locator] success={result.success}  "
          f"steps={len(result.trajectory.steps)}  tokens={result.trajectory.total_tokens}")


if __name__ == "__main__":
    asyncio.run(main())
