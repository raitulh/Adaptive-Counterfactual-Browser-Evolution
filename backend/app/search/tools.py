"""search tools: web search, SSRF-safe page fetch, search over indexed documents."""

from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator
from typing import Any
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.common.feature_flags import Flags
from app.core.exceptions import ConfigurationMissing
from app.search import service
from app.search.schemas import DocumentSearchHit, WebSearchHit
from app.security.ssrf import default_policy
from app.tools.base import Tool, ToolContext, ToolResult, ToolSpec


@contextlib.asynccontextmanager
async def _tenant_session(tctx: ToolContext) -> AsyncIterator[AsyncSession]:
    async with tctx.services.session_factory() as session:
        session.info["tenant_id"] = tctx.tenant_id
        yield session


# ---------------------------------------------------------------------------- search.web
class WebSearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=400)
    max_results: int = Field(default=5, ge=1, le=10)


class WebSearchOut(BaseModel):
    query: str
    provider: str
    results: list[WebSearchHit]


class SearchWebTool(Tool[WebSearchIn, WebSearchOut]):
    input_model = WebSearchIn
    output_model = WebSearchOut
    spec = ToolSpec(
        name="search.web", description="Search the web; returns ranked results with source citations",
        category="search", provider="web_search", permission_level=PermissionLevel.READ,
        risk_level=RiskLevel.LOW, timeout_seconds=25, feature_flag=Flags.WEB_SEARCH,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    async def execute(self, tctx: ToolContext, args: WebSearchIn) -> ToolResult:
        provider = tctx.services.search
        if provider is None:
            raise ConfigurationMissing("Web search is not configured on this server.",
                                       details={"feature": "web_search"})
        async with _tenant_session(tctx) as session:
            response = await service.web_search(session, tenant_id=tctx.tenant_id, user_id=tctx.user_id,
                                                query=args.query, max_results=args.max_results,
                                                provider=provider)
        out = WebSearchOut(query=response.query, provider=response.provider, results=response.results)
        return ToolResult(output=out.model_dump(mode="json"), trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
                          summary=f"Found {len(out.results)} web result(s)", usage={"search_queries": 1.0})


# ---------------------------------------------------------------------------- web.fetch
class WebFetchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=8, max_length=2048, description="http(s) URL of a public web page")
    max_chars: int = Field(default=20_000, ge=500, le=50_000)


class WebFetchOut(BaseModel):
    url: str
    final_url: str
    status_code: int
    content_type: str
    title: str | None = None
    text: str
    truncated: bool
    content_sha256: str
    retrieved_at: str


class WebFetchTool(Tool[WebFetchIn, WebFetchOut]):
    input_model = WebFetchIn
    output_model = WebFetchOut
    spec = ToolSpec(
        name="web.fetch", description="Fetch a public web page and return its readable text", category="web",
        provider="web", permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW, timeout_seconds=30,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    def target(self, args: WebFetchIn) -> str | None:
        try:
            host = urlsplit(args.url).hostname
        except ValueError:
            return None
        return f"web:{host}" if host else None

    async def execute(self, tctx: ToolContext, args: WebFetchIn) -> ToolResult:
        settings = tctx.services.settings
        policy = default_policy(
            allowed=tctx.org_policy.browser_allowed_domains or settings.browser_allowed_domains,
            denied=[*tctx.org_policy.browser_denied_domains, *settings.browser_denied_domains],
        )
        client: Any = tctx.services.extras.get("web_fetch_client")
        page = await service.fetch_page(args.url, policy=policy, max_chars=args.max_chars, client=client)
        out = WebFetchOut(url=page.url, final_url=page.final_url, status_code=page.status_code,
                          content_type=page.content_type, title=page.title, text=page.text,
                          truncated=page.truncated, content_sha256=page.content_sha256,
                          retrieved_at=page.retrieved_at.isoformat())
        return ToolResult(output=out.model_dump(), trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
                          summary=f"Fetched {len(out.text)} characters from "
                                  f"{urlsplit(out.final_url).hostname}")


# ---------------------------------------------------------------------------- documents.search
class DocumentsSearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=400)
    limit: int = Field(default=8, ge=1, le=20)


class DocumentsSearchOut(BaseModel):
    query: str
    used_vector_search: bool
    results: list[DocumentSearchHit]


class DocumentsSearchTool(Tool[DocumentsSearchIn, DocumentsSearchOut]):
    input_model = DocumentsSearchIn
    output_model = DocumentsSearchOut
    spec = ToolSpec(
        name="documents.search",
        description="Search the user's indexed documents and files (keyword + semantic)", category="search",
        permission_level=PermissionLevel.READ, risk_level=RiskLevel.LOW, timeout_seconds=20,
        output_trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
    )

    async def execute(self, tctx: ToolContext, args: DocumentsSearchIn) -> ToolResult:
        async with _tenant_session(tctx) as session:
            response = await service.search_documents(session, tenant_id=tctx.tenant_id, user_id=tctx.user_id,
                                                      query=args.query, limit=args.limit,
                                                      model_router=tctx.services.model)
        out = DocumentsSearchOut(query=response.query, used_vector_search=response.used_vector_search,
                                 results=response.results)
        return ToolResult(output=out.model_dump(mode="json"), trust=TrustLevel.UNTRUSTED_EXTERNAL_CONTENT,
                          summary=f"Found {len(out.results)} matching passage(s)")


TOOLS: list[Tool[Any, Any]] = [SearchWebTool(), WebFetchTool(), DocumentsSearchTool()]
