from __future__ import annotations

import json
from pathlib import Path
from typing import List

from acbe.core.types import Trajectory


class ExperienceBuffer:
    """Collects the structured trajectory of every task execution
    (Section 1). Kept in memory for the lifetime of a process and can be
    flushed to newline-delimited JSON for offline analysis / ACBE-Bench
    reporting."""

    def __init__(self) -> None:
        self._trajectories: List[Trajectory] = []

    def add(self, trajectory: Trajectory) -> None:
        self._trajectories.append(trajectory)

    def all(self) -> List[Trajectory]:
        return list(self._trajectories)

    def for_task(self, task_id: str) -> List[Trajectory]:
        return [t for t in self._trajectories if t.task_id == task_id]

    def for_environment(self, environment_id: str) -> List[Trajectory]:
        return [t for t in self._trajectories if t.environment_id == environment_id]

    def success_rate(self) -> float:
        if not self._trajectories:
            return 0.0
        return sum(1 for t in self._trajectories if t.success) / len(self._trajectories)

    def export_jsonl(self, path: str) -> str:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            for t in self._trajectories:
                fh.write(json.dumps(t.to_dict(), default=str) + "\n")
        return path
