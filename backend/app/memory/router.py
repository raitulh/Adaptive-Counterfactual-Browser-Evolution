"""Memory API: the caller's own memories only (tenant AND user come from the verified context)."""

from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import JSONResponse

from app.api.dependencies import DbSession, IdempotencyKeyHeader, require
from app.common.context import RequestContext
from app.common.idempotency import run_idempotent
from app.common.pagination import Page
from app.memory import service
from app.memory.models import MemoryType
from app.memory.schemas import MemoryCreate, MemoryOut, MemorySearchRequest, MemorySearchResponse
from app.model_gateway.router import get_model_router
from app.organizations.rbac import P

router = APIRouter(prefix="/memory", tags=["memory"])


@router.get("", response_model=Page[MemoryOut], summary="List your memories (newest first, cursor-paginated)")
async def list_memories(
    db: DbSession,
    ctx: RequestContext = Depends(require(P.MEMORY_READ)),
    cursor: str | None = Query(default=None, max_length=512),
    limit: int = Query(default=50, ge=1, le=200),
    memory_type: MemoryType | None = Query(default=None),
    status_filter: Literal["active", "superseded", "conflicted"] | None = Query(default=None, alias="status"),
) -> Page[MemoryOut]:
    return await service.list_memories(db, ctx, cursor=cursor, limit=limit,
                                       memory_type=memory_type.value if memory_type else None,
                                       status=status_filter)


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED,
             summary="Remember something you state explicitly (deduplicated; may supersede an older value)")
async def create_memory(body: MemoryCreate, db: DbSession, idempotency_key: IdempotencyKeyHeader = None,
                        ctx: RequestContext = Depends(require(P.MEMORY_WRITE))) -> Response:
    async def handler() -> tuple[int, MemoryOut]:
        item = await service.create_user_memory(db, ctx, body)
        return status.HTTP_201_CREATED, service.to_memory_out(item)

    result = await run_idempotent(ctx, idempotency_key, "POST", "/memory", body.model_dump(mode="json"),
                                  handler)
    headers = {"Idempotent-Replayed": "true"} if result.replayed else {}
    return JSONResponse(result.body, status_code=result.status_code, headers=headers)


@router.post("/search", response_model=MemorySearchResponse,
             summary="Hybrid search (keyword + semantic + recency + importance) over your memories")
async def search_memories(body: MemorySearchRequest, db: DbSession,
                          ctx: RequestContext = Depends(require(P.MEMORY_READ))) -> MemorySearchResponse:
    await db.commit()  # close the authentication read transaction before the embedding call
    results = await service.search_memories(
        db, tenant_id=ctx.tenant_id, user_id=ctx.user_id, query=body.query, limit=body.limit,
        memory_types=[t.value for t in body.memory_types] if body.memory_types else None,
        model_router=get_model_router())
    await db.commit()  # persist access statistics
    return MemorySearchResponse(results=results)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None,
               summary="Delete a memory and its derived data (embedding, sources)")
async def delete_memory(memory_id: uuid.UUID, db: DbSession,
                        ctx: RequestContext = Depends(require(P.MEMORY_WRITE))) -> Response:
    await service.delete_memory(db, ctx, memory_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{memory_id}/verify", response_model=MemoryOut,
             summary="Re-affirm a memory (marks it fresh and trusted; resolves a conflict in its favour)")
async def verify_memory(memory_id: uuid.UUID, db: DbSession,
                        ctx: RequestContext = Depends(require(P.MEMORY_WRITE))) -> MemoryOut:
    return service.to_memory_out(await service.verify_memory(db, ctx, memory_id))
