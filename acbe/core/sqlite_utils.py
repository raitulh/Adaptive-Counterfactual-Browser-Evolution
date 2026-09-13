"""
Shared SQLite connection helper.

``with sqlite3.connect(path) as conn:`` does NOT close the connection when
the block exits -- per the sqlite3 docs, the connection object's context
manager only commits (on success) or rolls back (on exception); closing is
a separate, manual step. Every store in this package (``memory``,
``failure``, ``experiments``, ``evolution``) used to open a fresh
connection per call via that pattern, which meant every read or write leaked
a connection/file descriptor. ``sqlite_connection`` fixes that in one place:
commit-or-rollback semantics are preserved, and the connection is always
closed afterward.
"""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator


@contextmanager
def sqlite_connection(db_path: str) -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
