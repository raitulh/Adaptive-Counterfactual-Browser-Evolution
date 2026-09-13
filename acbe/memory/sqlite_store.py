from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path
from typing import List, Optional

from acbe.core.sqlite_utils import sqlite_connection
from acbe.memory.base import StrategyMemory
from acbe.strategy.models import Strategy, StrategyLifecycle

_SCHEMA = """
CREATE TABLE IF NOT EXISTS strategies (
    strategy_id TEXT PRIMARY KEY,
    failure_pattern TEXT NOT NULL,
    lifecycle TEXT NOT NULL,
    version TEXT NOT NULL,
    trials INTEGER NOT NULL DEFAULT 0,
    successes INTEGER NOT NULL DEFAULT 0,
    transfer_trials INTEGER NOT NULL DEFAULT 0,
    transfer_successes INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL,
    last_validated_at REAL,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_failure_pattern ON strategies(failure_pattern);
CREATE INDEX IF NOT EXISTS idx_lifecycle ON strategies(lifecycle);
"""


class SQLiteStrategyMemory(StrategyMemory):
    """Synchronous SQLite access wrapped behind an async interface via
    ``asyncio.to_thread`` -- sqlite3 has no native async driver in the
    standard library, and this keeps the dependency footprint at zero.
    """

    def __init__(self, db_path: str = ".acbe/acbe.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.executescript(_SCHEMA)

    # -- sync internals ----------------------------------------------------
    def _store_sync(self, strategy: Strategy) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO strategies
                   (strategy_id, failure_pattern, lifecycle, version, trials, successes,
                    transfer_trials, transfer_successes, created_at, last_validated_at, payload)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    strategy.strategy_id, strategy.failure_pattern, strategy.lifecycle.value,
                    strategy.version, strategy.trials, strategy.successes,
                    strategy.transfer_trials, strategy.transfer_successes,
                    strategy.created_at, strategy.last_validated_at,
                    json.dumps(strategy.to_dict()),
                ),
            )

    def _row_to_strategy(self, row: sqlite3.Row) -> Strategy:
        data = json.loads(row["payload"])
        data["lifecycle"] = StrategyLifecycle(data["lifecycle"])
        return Strategy.from_dict(data)

    def _get_sync(self, strategy_id: str) -> Optional[Strategy]:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute("SELECT * FROM strategies WHERE strategy_id = ?", (strategy_id,)).fetchone()
            return self._row_to_strategy(row) if row else None

    def _retrieve_sync(self, failure_pattern: str, environment_id: Optional[str],
                        min_success_rate: float, lifecycle: Optional[List[str]]) -> List[Strategy]:
        with sqlite_connection(self.db_path) as conn:
            query = "SELECT * FROM strategies WHERE failure_pattern = ?"
            params: list = [failure_pattern]
            if lifecycle:
                placeholders = ",".join("?" for _ in lifecycle)
                query += f" AND lifecycle IN ({placeholders})"
                params.extend(lifecycle)
            rows = conn.execute(query, params).fetchall()
        strategies = [self._row_to_strategy(r) for r in rows]
        strategies = [s for s in strategies if s.success_rate >= min_success_rate or s.trials == 0]
        if environment_id:
            # Bias results: strategies already validated in this exact
            # environment first, then everything else (cross-task transfer
            # candidates), each group best-success-rate first.
            seen = [s for s in strategies if environment_id in s.environments_seen]
            unseen = [s for s in strategies if environment_id not in s.environments_seen]
            seen.sort(key=lambda s: s.success_rate, reverse=True)
            unseen.sort(key=lambda s: s.success_rate, reverse=True)
            return seen + unseen
        strategies.sort(key=lambda s: s.success_rate, reverse=True)
        return strategies

    def _list_all_sync(self) -> List[Strategy]:
        with sqlite_connection(self.db_path) as conn:
            rows = conn.execute("SELECT * FROM strategies").fetchall()
        return [self._row_to_strategy(r) for r in rows]

    # -- async public interface --------------------------------------------
    async def store(self, strategy: Strategy) -> None:
        await asyncio.to_thread(self._store_sync, strategy)

    async def update(self, strategy: Strategy) -> None:
        await asyncio.to_thread(self._store_sync, strategy)

    async def get(self, strategy_id: str) -> Optional[Strategy]:
        return await asyncio.to_thread(self._get_sync, strategy_id)

    async def retrieve(self, failure_pattern: str, environment_id: Optional[str] = None,
                        min_success_rate: float = 0.0, lifecycle: Optional[List[str]] = None) -> List[Strategy]:
        return await asyncio.to_thread(self._retrieve_sync, failure_pattern, environment_id, min_success_rate, lifecycle)

    async def list_all(self) -> List[Strategy]:
        return await asyncio.to_thread(self._list_all_sync)
