"""Re-encrypt credentials at rest under the primary TOKEN_ENCRYPTION_KEY.

Rotation procedure (see docs/operations.md):

1. Deploy with the new key as ``TOKEN_ENCRYPTION_KEY`` and the old one in
   ``TOKEN_ENCRYPTION_PREVIOUS_KEYS`` (everything keeps decrypting; new writes use the new key).
2. Run ``python -m app.cli rotate-encryption`` (idempotent, batched, safe while the app runs).
3. When it reports zero failures, remove the old key from ``TOKEN_ENCRYPTION_PREVIOUS_KEYS``.

Each value is rewritten with a compare-and-set (``WHERE id = :id AND col = :old``), so a
concurrent writer (e.g. an OAuth token refresh, which always encrypts under the primary key)
is never overwritten with a stale token; such rows are simply counted as ``changed_concurrently``.
Plaintext never leaves this function and is never logged.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.crypto import DecryptionError, KeyManager
from app.core.database import Base

logger = logging.getLogger(__name__)

# Every column holding KeyManager ciphertext. A new encrypted column must be added here
# (tests/integration/test_key_rotation.py fails if an ``*_enc``/``*_encrypted`` column is missing).
ENCRYPTED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("oauth_connections", "access_token_enc"),
    ("oauth_connections", "refresh_token_enc"),
    ("mfa_factors", "secret_encrypted"),
    ("tool_credentials", "secret_encrypted"),
    ("mcp_servers", "auth_header_enc"),
)


@dataclass(slots=True)
class RotationReport:
    rotated: dict[str, int] = field(default_factory=dict)
    changed_concurrently: int = 0
    # "table.column:id" of values no configured key can decrypt (never the values themselves).
    failed: list[str] = field(default_factory=list)

    @property
    def total_rotated(self) -> int:
        return sum(self.rotated.values())


async def rotate_encrypted_columns(session_factory: async_sessionmaker[AsyncSession], key_manager: KeyManager, *,
                                   batch_size: int = 500, dry_run: bool = False) -> RotationReport:
    from app.db_models import import_all_models

    import_all_models()
    report = RotationReport()
    for table_name, column_name in ENCRYPTED_COLUMNS:
        table = Base.metadata.tables[table_name]
        pk, column = table.c.id, table.c[column_name]
        label = f"{table_name}.{column_name}"
        report.rotated[label] = 0
        last_id: uuid.UUID | None = None
        while True:
            async with session_factory() as session:
                session.info["system"] = True  # operator maintenance across all tenants
                query = select(pk, column).where(column.is_not(None)).order_by(pk).limit(batch_size)
                if last_id is not None:
                    query = query.where(pk > last_id)
                rows: list[Any] = list((await session.execute(query)).all())
                if not rows:
                    break
                for row_id, ciphertext in rows:
                    try:
                        rotated = key_manager.rotate(ciphertext)
                    except DecryptionError:
                        report.failed.append(f"{label}:{row_id}")
                        continue
                    if dry_run:
                        report.rotated[label] += 1
                        continue
                    result = await session.execute(
                        update(table).where(pk == row_id, column == ciphertext).values({column_name: rotated}))
                    if result.rowcount:  # type: ignore[attr-defined]
                        report.rotated[label] += 1
                    else:
                        report.changed_concurrently += 1
                if dry_run:
                    await session.rollback()
                else:
                    await session.commit()
                last_id = rows[-1][0]
        logger.info("encrypted column processed", extra={"column": label, "rotated": report.rotated[label],
                                                         "dry_run": dry_run})
    return report
