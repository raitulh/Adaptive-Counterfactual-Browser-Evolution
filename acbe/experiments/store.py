from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from acbe.core.sqlite_utils import sqlite_connection
from acbe.core.types import Experiment

_SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    experiment_id TEXT PRIMARY KEY,
    strategy TEXT,
    status TEXT NOT NULL,
    created_at REAL NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_experiment_status ON experiments(status);
"""


class ExperimentStore:
    """Persists ``Experiment`` objects so ``acbe history``, ``acbe compare``
    and ``acbe experiment reproduce <id>`` work across separate CLI
    invocations (Section 12/29)."""

    def __init__(self, db_path: str = ".acbe/acbe.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite_connection(self.db_path) as conn:
            conn.executescript(_SCHEMA)

    def save(self, experiment: Experiment) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO experiments (experiment_id, strategy, status, created_at, payload) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    experiment.experiment_id, experiment.strategy, experiment.status.value,
                    experiment.created_at, json.dumps(experiment.to_dict()),
                ),
            )

    def get(self, experiment_id: str) -> Optional[Experiment]:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT payload FROM experiments WHERE experiment_id = ?", (experiment_id,)
            ).fetchone()
        return Experiment.from_dict(json.loads(row["payload"])) if row else None

    def list_all(self, limit: int = 100) -> List[Experiment]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT payload FROM experiments ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [Experiment.from_dict(json.loads(r["payload"])) for r in rows]
