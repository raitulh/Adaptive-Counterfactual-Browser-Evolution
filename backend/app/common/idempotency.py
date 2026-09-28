"""API-level idempotency for write endpoints (``Idempotency-Key`` header).

Semantics:
* first request with a key claims it (committed immediately in its own
  transaction) and runs the handler; the response is stored;
* a retry with the same key and the same payload replays the stored response
  (``Idempotent-Replayed: true``) instead of repeating the operation;
* a retry while the first is still running gets 409; reusing a key with a
  different payload gets 422;
* 4xx outcomes are stored (deterministic); on 5xx/unexpected errors the claim
  is released so the client can safely retry.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from fastapi.encoders import jsonable_encoder
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from app.common.context import RequestContext
from app.common.ids import new_id
from app.common.models import ApiIdempotencyKey
from app.common.time import ensure_aware, utcnow
from app.core.database import get_session_factory
from app.core.exceptions import AppError, IdempotencyConflict, ValidationFailed

IDEMPOTENCY_TTL = timedelta(hours=24)


@dataclass(slots=True)
class IdempotentResult:
    status_code: int
    body: Any
    replayed: bool


def fingerprint(method: str, path: str, payload: Any) -> str:
    raw = json.dumps(jsonable_encoder(payload), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(f"{method}|{path}|{raw}".encode()).hexdigest()


async def run_idempotent(ctx: RequestContext, key: str | None, method: str, path: str, payload: Any,
                         handler: Callable[[], Awaitable[tuple[int, Any]]]) -> IdempotentResult:
    if not key:
        status, body = await handler()
        return IdempotentResult(status, jsonable_encoder(body), False)

    request_hash = fingerprint(method, path, payload)
    sf = get_session_factory()
    async with sf() as session:
        session.info["system"] = True
        now = utcnow()
        claimed = (await session.execute(
            insert(ApiIdempotencyKey).values(
                id=new_id(), tenant_id=ctx.tenant_id, user_id=ctx.user_id, key=key, method=method, path=path,
                request_hash=request_hash, status="in_progress", expires_at=now + IDEMPOTENCY_TTL,
            ).on_conflict_do_nothing(index_elements=["tenant_id", "user_id", "key"]).returning(ApiIdempotencyKey.id)
        )).scalar_one_or_none()
        if claimed is None:
            existing = (await session.execute(
                select(ApiIdempotencyKey).where(ApiIdempotencyKey.tenant_id == ctx.tenant_id,
                                                ApiIdempotencyKey.user_id == ctx.user_id,
                                                ApiIdempotencyKey.key == key)
            )).scalar_one()
            if ensure_aware(existing.expires_at) <= now:
                await session.delete(existing)
                await session.commit()
                return await run_idempotent(ctx, key, method, path, payload, handler)
            snapshot = (existing.request_hash, existing.status, existing.response_status, existing.response_body)
            await session.rollback()  # expires ORM state: use the snapshot below
            stored_hash, stored_status, response_status, response_body = snapshot
            if stored_hash != request_hash:
                raise ValidationFailed("Idempotency-Key was already used with a different request",
                                       code="idempotency_key_reused")
            if stored_status != "completed":
                raise IdempotencyConflict()
            return IdempotentResult(response_status or 200, response_body, True)
        await session.commit()

    try:
        status, body = await handler()
    except AppError as exc:
        if exc.status_code >= 500:
            await _release(ctx, key)
        else:
            from app.api.errors import error_payload

            await _store(ctx, key, exc.status_code, error_payload(exc.code, exc.message, exc.details))
        raise
    except BaseException:
        await _release(ctx, key)
        raise
    encoded = jsonable_encoder(body)
    await _store(ctx, key, status, encoded)
    return IdempotentResult(status, encoded, False)


async def _store(ctx: RequestContext, key: str, status: int, body: Any) -> None:
    async with get_session_factory()() as session:
        session.info["system"] = True
        row = (await session.execute(
            select(ApiIdempotencyKey).where(ApiIdempotencyKey.tenant_id == ctx.tenant_id,
                                            ApiIdempotencyKey.user_id == ctx.user_id, ApiIdempotencyKey.key == key)
        )).scalar_one_or_none()
        if row is not None:
            row.status = "completed"
            row.response_status = status
            row.response_body = body
            await session.commit()


async def _release(ctx: RequestContext, key: str) -> None:
    async with get_session_factory()() as session:
        session.info["system"] = True
        await session.execute(delete(ApiIdempotencyKey).where(
            ApiIdempotencyKey.tenant_id == ctx.tenant_id, ApiIdempotencyKey.user_id == ctx.user_id,
            ApiIdempotencyKey.key == key, ApiIdempotencyKey.status == "in_progress"))
        await session.commit()
