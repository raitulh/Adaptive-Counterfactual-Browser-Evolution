"""Cursor (keyset) pagination.

Cursors encode the ``(created_at, id)`` of the last row returned, so paging
stays O(log n) and stable under concurrent inserts — unlike OFFSET paging,
which degrades on large event/task tables.
"""

from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field
from sqlalchemy import Select, and_, or_

from app.core.exceptions import ValidationFailed

T = TypeVar("T")

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = Field(default=None, description="Opaque cursor for the next page")
    has_more: bool = False


def encode_cursor(created_at: datetime, row_id: uuid.UUID, direction: str = "desc") -> str:
    raw = json.dumps({"t": created_at.isoformat(), "i": str(row_id), "d": direction}).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return datetime.fromisoformat(data["t"]), uuid.UUID(data["i"]), data.get("d", "desc")
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationFailed("Invalid pagination cursor", details={"cursor": "malformed"}) from exc


def clamp_limit(limit: int | None) -> int:
    if limit is None:
        return DEFAULT_LIMIT
    return max(1, min(int(limit), MAX_LIMIT))


def apply_keyset(stmt: Select[Any], model: Any, cursor: str | None, limit: int, *, descending: bool = True
                 ) -> Select[Any]:
    created_col, id_col = model.created_at, model.id
    if cursor:
        created_at, row_id, _ = decode_cursor(cursor)
        if descending:
            stmt = stmt.where(or_(created_col < created_at, and_(created_col == created_at, id_col < row_id)))
        else:
            stmt = stmt.where(or_(created_col > created_at, and_(created_col == created_at, id_col > row_id)))
    order = (created_col.desc(), id_col.desc()) if descending else (created_col.asc(), id_col.asc())
    return stmt.order_by(*order).limit(limit + 1)


def build_page(rows: list[Any], limit: int, serializer: Any, *, descending: bool = True) -> Page[Any]:
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(last.created_at, last.id, "desc" if descending else "asc")
    return Page(items=[serializer(r) for r in rows], next_cursor=next_cursor, has_more=has_more)
