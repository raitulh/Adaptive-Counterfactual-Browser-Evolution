from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional

from acbe.core.sqlite_utils import sqlite_connection
from acbe.failure.fingerprint import FailureFingerprint

_SCHEMA = """
CREATE TABLE IF NOT EXISTS failures (
    fingerprint_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL,
    failure_type TEXT NOT NULL,
    environment_id TEXT,
    timestamp REAL NOT NULL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_failure_type ON failures(failure_type);
"""


class FailureStore:
    """Persists ``FailureFingerprint`` objects so ``acbe failures`` and the
    dashboard's Failure Lab can show history across separate CLI
    invocations, not just within a single in-memory process."""

    def __init__(self, db_path: str = ".acbe/acbe.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite_connection(self.db_path) as conn:
            conn.executescript(_SCHEMA)

    def save(self, fingerprint: FailureFingerprint) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO failures (fingerprint_id, task_id, failure_type, "
                "environment_id, timestamp, payload) VALUES (?, ?, ?, ?, ?, ?)",
                (
                    fingerprint.fingerprint_id, fingerprint.task_id, fingerprint.failure_type,
                    fingerprint.environment_id, fingerprint.timestamp, json.dumps(fingerprint.to_dict()),
                ),
            )

    def get(self, fingerprint_id: str) -> Optional[FailureFingerprint]:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT payload FROM failures WHERE fingerprint_id = ?", (fingerprint_id,)
            ).fetchone()
        return FailureFingerprint.from_dict(json.loads(row["payload"])) if row else None

    def list_all(self, limit: int = 100) -> List[FailureFingerprint]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT payload FROM failures ORDER BY timestamp DESC LIMIT ?", (limit,)
            ).fetchall()
        return [FailureFingerprint.from_dict(json.loads(r["payload"])) for r in rows]

    def counts_by_type(self) -> dict:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute(
                "SELECT failure_type, COUNT(*) as n FROM failures GROUP BY failure_type"
            ).fetchall()
        return {r["failure_type"]: r["n"] for r in rows}
