"""search.web / documents.search / web.fetch tools against the real database."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable

import httpx
import pytest
from files_fixtures import ApiUser, ControlledScanner
from sqlalchemy import select

from app.core.database import get_session_factory
from app.files.storage import LocalFilesystemStorage
from app.files.tools import WriteTextIn, WriteTextTool
from app.search.models import SearchDocument, SourceType
from app.search.providers import SearchResult
from app.search.tools import (
    TOOLS,
    DocumentsSearchIn,
    DocumentsSearchTool,
    SearchWebTool,
    WebFetchIn,
    WebFetchTool,
    WebSearchIn,
)
from app.tools.base import ToolContext
from app.tools.registry import ToolRegistry

pytestmark = pytest.mark.integration

Register = Callable[[], Awaitable[ApiUser]]
MakeTctx = Callable[..., ToolContext]
RunJob = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


class StaticProvider:
    name = "static"

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        return [SearchResult(title="Tide tables", url="https://sea.example/tides#today", snippet="tide times",
                             provider=self.name, rank=1)]


def test_search_tools_register() -> None:
    registry = ToolRegistry()
    for tool in TOOLS:
        registry.register(tool)
    specs = {t.spec.name: t.spec for t in TOOLS}
    assert set(specs) == {"search.web", "web.fetch", "documents.search"}
    assert all(s.permission_level == "read" for s in specs.values())
    assert specs["search.web"].output_trust == "untrusted_external_content"
    assert specs["web.fetch"].output_trust == "untrusted_external_content"


async def test_search_web_tool_persists_and_cites(register: Register, make_tctx: MakeTctx) -> None:
    user = await register()
    result = await SearchWebTool().execute(make_tctx(user, search=StaticProvider()),
                                           WebSearchIn(query="tide times", max_results=3))
    assert result.trust == "untrusted_external_content"
    hit = result.output["results"][0]
    assert hit["url"] == "https://sea.example/tides" and hit["citation"]["provider"] == "static"
    async with get_session_factory()() as session:
        session.info["tenant_id"] = user.tenant_id
        docs = (await session.execute(select(SearchDocument).where(
            SearchDocument.source_type == SourceType.WEB))).scalars().all()
    assert [d.url for d in docs] == ["https://sea.example/tides"]


async def test_documents_search_tool_finds_written_file(register: Register, make_tctx: MakeTctx,
                                                        storage: LocalFilesystemStorage,
                                                        scanner: ControlledScanner, run_process_job: RunJob) -> None:
    user, other = await register(), await register()
    written = await WriteTextTool().execute(
        make_tctx(user), WriteTextIn(filename="minutes", content="Board minutes: approve the heliotrope budget. " * 10))
    await run_process_job(user.tenant_id, uuid.UUID(written.output["file_id"]))
    found = await DocumentsSearchTool().execute(make_tctx(user), DocumentsSearchIn(query="heliotrope budget"))
    assert found.trust == "untrusted_external_content"
    assert found.output["used_vector_search"] is True
    assert found.output["results"][0]["source_id"] == written.output["file_id"]
    hidden = await DocumentsSearchTool().execute(make_tctx(other), DocumentsSearchIn(query="heliotrope budget"))
    assert hidden.output["results"] == []


async def test_web_fetch_tool_uses_injected_client(register: Register, make_tctx: MakeTctx) -> None:
    user = await register()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "text/html"},
                              content=b"<title>Status</title><p>All systems operational</p>")

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    result = await WebFetchTool().execute(make_tctx(user, extras={"web_fetch_client": client}),
                                          WebFetchIn(url="http://93.184.216.34/status"))
    assert result.output["title"] == "Status" and result.output["text"] == "All systems operational"
    await client.aclose()
