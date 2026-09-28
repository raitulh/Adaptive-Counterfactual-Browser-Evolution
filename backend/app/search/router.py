"""search API."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import Ctx, DbSession, require
from app.common.context import RequestContext
from app.common.feature_flags import Flags, require_enabled
from app.core.config import get_settings
from app.model_gateway.router import get_model_router
from app.organizations.rbac import P
from app.search import service
from app.search.providers import get_search_provider
from app.search.schemas import (
    DocumentSearchRequest,
    DocumentSearchResponse,
    WebSearchRequest,
    WebSearchResponse,
)
from app.security.ratelimit import get_rate_limiter

router = APIRouter(prefix="/search", tags=["search"])


@router.post("/web", response_model=WebSearchResponse, summary="Search the web (ranked, deduplicated, cited)",
             responses={403: {"description": "Web search disabled"}, 429: {"description": "Rate limited"},
                        503: {"description": "Web search not configured"}})
async def search_web(body: WebSearchRequest, ctx: Ctx, db: DbSession) -> WebSearchResponse:
    await require_enabled(db, Flags.WEB_SEARCH, ctx.tenant_id)
    settings = get_settings()
    await get_rate_limiter().enforce("search", str(ctx.user_id), settings.rate_limit_search_per_minute)
    await db.commit()  # no transaction is held across the provider call
    return await service.web_search(db, tenant_id=ctx.tenant_id, user_id=ctx.user_id, query=body.query,
                                    max_results=body.max_results, provider=get_search_provider())


@router.post("/documents", response_model=DocumentSearchResponse,
             summary="Search your indexed documents (hybrid keyword + semantic)")
async def search_documents(body: DocumentSearchRequest,
                           ctx: Annotated[RequestContext, Depends(require(P.FILES_READ))],
                           db: DbSession) -> DocumentSearchResponse:
    await db.commit()  # the query embedding call happens before the search statements
    return await service.search_documents(db, tenant_id=ctx.tenant_id, user_id=ctx.user_id, query=body.query,
                                          limit=body.limit, model_router=get_model_router())
