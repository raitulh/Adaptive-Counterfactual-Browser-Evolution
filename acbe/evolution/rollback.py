"""
Rollback (Section 14). Every strategy and agent configuration is versioned;
this module tracks that history and lets the system (or a human, via the
CLI) move the "active" pointer for a given kind of artifact back to a
previously-known-good version.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from acbe.core.sqlite_utils import sqlite_connection
from acbe.core.types import now_ts

_SCHEMA = """
CREATE TABLE IF NOT EXISTS versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    version TEXT NOT NULL,
    parent_version TEXT,
    created_at REAL NOT NULL,
    metadata TEXT NOT NULL,
    UNIQUE(kind, version)
);
CREATE TABLE IF NOT EXISTS active_pointers (
    kind TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS rollback_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    from_version TEXT,
    to_version TEXT NOT NULL,
    reason TEXT,
    timestamp REAL NOT NULL
);
"""


class VersionNotFoundError(KeyError):
    pass


class VersionHistory:
    def __init__(self, db_path: str = ".acbe/acbe.db"):
        self.db_path = db_path
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        with sqlite_connection(self.db_path) as conn:
            conn.executescript(_SCHEMA)

    def record(self, kind: str, version: str, parent_version: Optional[str] = None,
               metadata: Optional[Dict[str, Any]] = None, make_active: bool = True) -> None:
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO versions (kind, version, parent_version, created_at, metadata) "
                "VALUES (?, ?, ?, ?, ?)",
                (kind, version, parent_version, now_ts(), json.dumps(metadata or {})),
            )
            if make_active:
                conn.execute(
                    "INSERT OR REPLACE INTO active_pointers (kind, version, updated_at) VALUES (?, ?, ?)",
                    (kind, version, now_ts()),
                )

    def current(self, kind: str) -> Optional[str]:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute("SELECT version FROM active_pointers WHERE kind = ?", (kind,)).fetchone()
            return row["version"] if row else None

    def history(self, kind: Optional[str] = None) -> List[Dict[str, Any]]:
        with sqlite_connection(self.db_path) as conn:
            if kind:
                rows = conn.execute(
                    "SELECT * FROM versions WHERE kind = ? ORDER BY created_at ASC", (kind,)
                ).fetchall()
            else:
                rows = conn.execute("SELECT * FROM versions ORDER BY created_at ASC").fetchall()
        return [
            {
                "kind": r["kind"], "version": r["version"], "parent_version": r["parent_version"],
                "created_at": r["created_at"], "metadata": json.loads(r["metadata"]),
            }
            for r in rows
        ]

    def get(self, kind: str, version: str) -> Dict[str, Any]:
        with sqlite_connection(self.db_path) as conn:
            row = conn.execute(
                "SELECT * FROM versions WHERE kind = ? AND version = ?", (kind, version)
            ).fetchone()
        if not row:
            raise VersionNotFoundError(f"{kind}:{version}")
        return {
            "kind": row["kind"], "version": row["version"], "parent_version": row["parent_version"],
            "created_at": row["created_at"], "metadata": json.loads(row["metadata"]),
        }

    def compare(self, kind: str, version_a: str, version_b: str) -> Dict[str, Any]:
        a, b = self.get(kind, version_a), self.get(kind, version_b)
        keys = set(a["metadata"]) | set(b["metadata"])
        diff = {}
        for k in keys:
            va, vb = a["metadata"].get(k), b["metadata"].get(k)
            if va != vb:
                diff[k] = {"from": va, "to": vb}
        return {"a": version_a, "b": version_b, "diff": diff}

    def rollback(self, kind: str, target_version: str, reason: str = "") -> str:
        current = self.current(kind)
        self.get(kind, target_version)  # raises VersionNotFoundError if unknown
        with sqlite_connection(self.db_path) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO active_pointers (kind, version, updated_at) VALUES (?, ?, ?)",
                (kind, target_version, now_ts()),
            )
            conn.execute(
                "INSERT INTO rollback_events (kind, from_version, to_version, reason, timestamp) "
                "VALUES (?, ?, ?, ?, ?)",
                (kind, current, target_version, reason, now_ts()),
            )
        return target_version
