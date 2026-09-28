"""Search HTTP API: web search pipeline (flag, rate limit, persistence, usage) and hybrid
document search with tenant/ownership isolation."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

import httpx
import pytest
import pytest_asyncio
from files_fixtures import ApiUser, ControlledScanner
from sqlalchemy import select

from app.common.feature_flags import Flags, clear_cache
from app.common.models import FeatureFlag
from app.core.config import get_settings
from app.core.database import get_session_factory
from app.core.exceptions import IntegrationRateLimited
from app.files.storage import LocalFilesystemStorage
from app.model_gateway.router import ModelRouter
from app.search import service as search_service
from app.search.models import SearchDocument, SourceType
from app.search.providers import SearchResult, reset_search_provider, set_search_provider
from app.usage.models import UsageEvent, UsageKind

pytestmark = pytest.mark.integration

Register = Callable[[], Awaitable[ApiUser]]
RunJob = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


class FakeProvider:
    name = "fake"

    def __init__(self) -> None:
        self.error: Exception | None = None
        self.queries: list[tuple[str, int]] = []
        self.results = [
            SearchResult(title="Cooking pasta", url="https://food.example/pasta", snippet="boil water",
                         provider="fake", rank=1),
            SearchResult(title="Rust <b>ownership</b> explained", url="https://Docs.Example/rust?utm_source=x#top",
                         snippet="borrow checker and rust ownership rules", provider="fake", rank=2),
            SearchResult(title="dup", url="https://docs.example/rust?gclid=abc", snippet="", provider="fake",
                         rank=3),
            SearchResult(title="Ownership in Rust", url="https://blog.example/rust-ownership",
                         snippet="rust ownership deep dive", provider="fake", rank=4),
        ]

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        self.queries.append((query, max_results))
        if self.error is not None:
            raise self.error
        return list(self.results)


@pytest_asyncio.fixture
async def provider() -> AsyncIterator[FakeProvider]:
    fake = FakeProvider()
    set_search_provider(fake)
    yield fake
    reset_search_provider()


async def _all(stmt: Any) -> list[Any]:
    async with get_session_factory()() as session:
        session.info["system"] = True
        return list((await session.execute(stmt)).scalars().all())


async def test_web_search_pipeline(api: httpx.AsyncClient, register: Register, provider: FakeProvider) -> None:
    user = await register()
    resp = await api.post("/api/v1/search/web", headers=user.headers,
                          json={"query": "  rust   ownership ", "max_results": 5})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["query"] == "rust ownership" and body["provider"] == "fake"
    urls = [r["url"] for r in body["results"]]
    assert urls[0] == "https://docs.example/rust"
    assert urls.count("https://docs.example/rust") == 1 and len(urls) == 3
    assert urls[-1] == "https://food.example/pasta"
    top = body["results"][0]
    assert top["title"] == "Rust ownership explained"
    assert top["citation"]["source_url"] == top["url"] and top["citation"]["provider"] == "fake"
    assert top["document_id"] is not None

    docs = await _all(select(SearchDocument).where(SearchDocument.tenant_id == user.tenant_id,
                                                   SearchDocument.source_type == SourceType.WEB))
    assert {d.url for d in docs} == set(urls)
    assert all(d.user_id is None and d.provider == "fake" for d in docs)
    again = await api.post("/api/v1/search/web", headers=user.headers, json={"query": "rust ownership"})
    assert again.status_code == 200
    docs_after = await _all(select(SearchDocument).where(SearchDocument.tenant_id == user.tenant_id,
                                                         SearchDocument.source_type == SourceType.WEB))
    assert len(docs_after) == len(docs), "re-searching upserts instead of duplicating"
    usage = await _all(select(UsageEvent).where(UsageEvent.tenant_id == user.tenant_id,
                                                UsageEvent.kind == UsageKind.SEARCH_QUERY))
    assert len(usage) == 2 and all(u.user_id == user.user_id for u in usage)


async def test_web_search_not_configured(api: httpx.AsyncClient, register: Register) -> None:
    user = await register()
    set_search_provider(None)
    try:
        resp = await api.post("/api/v1/search/web", headers=user.headers, json={"query": "anything"})
    finally:
        reset_search_provider()
    assert resp.status_code == 503 and resp.json()["error"]["code"] == "configuration_missing"


async def test_web_search_feature_flag(api: httpx.AsyncClient, register: Register, provider: FakeProvider) -> None:
    user = await register()
    async with get_session_factory()() as session:
        session.info["system"] = True
        session.add(FeatureFlag(key=Flags.WEB_SEARCH, tenant_id=user.tenant_id, enabled=False))
        await session.commit()
    clear_cache()
    resp = await api.post("/api/v1/search/web", headers=user.headers, json={"query": "rust"})
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "feature_disabled"
    assert provider.queries == []


async def test_web_search_rate_limit_and_provider_errors(api: httpx.AsyncClient, register: Register,
                                                         provider: FakeProvider,
                                                         monkeypatch: pytest.MonkeyPatch) -> None:
    user = await register()
    monkeypatch.setattr(get_settings(), "rate_limit_search_per_minute", 2)
    codes = [(await api.post("/api/v1/search/web", headers=user.headers, json={"query": "rust"})).status_code
             for _ in range(3)]
    assert codes == [200, 200, 429]
    other = await register()
    provider.error = IntegrationRateLimited(provider="fake", status=429)
    resp = await api.post("/api/v1/search/web", headers=other.headers, json={"query": "rust"})
    assert resp.status_code == 429 and resp.json()["error"]["code"] == "integration_rate_limited"
    invalid = await api.post("/api/v1/search/web", headers=other.headers, json={"query": "", "max_results": 5})
    assert invalid.status_code == 422
    extra = await api.post("/api/v1/search/web", headers=other.headers, json={"query": "x", "admin": True})
    assert extra.status_code == 422


async def _upload_and_process(api: httpx.AsyncClient, user: ApiUser, text: str, run_job: RunJob) -> str:
    resp = await api.post("/api/v1/files", headers=user.headers, files={"file": ("n.txt", text.encode(), "text/plain")})
    assert resp.status_code == 201, resp.text
    file_id = resp.json()["id"]
    await run_job(user.tenant_id, uuid.UUID(file_id))
    return str(file_id)


async def test_document_search_hybrid_and_isolated(
        api: httpx.AsyncClient, register: Register, storage: LocalFilesystemStorage, scanner: ControlledScanner,
        run_process_job: RunJob, model_router: ModelRouter) -> None:
    owner, outsider = await register(), await register()
    target = await _upload_and_process(
        api, owner, "Field notes: the narwhal population near Svalbard grew this season. " * 20, run_process_job)
    await _upload_and_process(api, owner, "Unrelated budget spreadsheet commentary about invoices. " * 20,
                              run_process_job)
    await _upload_and_process(api, outsider, "Outsider notes about the narwhal population near Svalbard. " * 5,
                              run_process_job)
    async with get_session_factory()() as session:
        session.info["tenant_id"] = owner.tenant_id
        # Same tenant, another user's private document: must stay invisible to the owner.
        await search_service.index_document(
            session, tenant_id=owner.tenant_id, user_id=outsider.user_id, source_type=SourceType.FILE,
            source_id=str(uuid.uuid4()), title="private", chunks=[search_service.IndexChunk("narwhal secret")])
        # Tenant-shared web content is visible to every member.
        await search_service.index_document(
            session, tenant_id=owner.tenant_id, user_id=None, source_type=SourceType.WEB,
            source_id=search_service.url_hash("https://wiki.example/narwhal"), url="https://wiki.example/narwhal",
            title="Narwhal - wiki", chunks=[search_service.IndexChunk("The narwhal population is a toothed whale group.")])
        await session.commit()

    resp = await api.post("/api/v1/search/documents", headers=owner.headers,
                          json={"query": "narwhal population", "limit": 5})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["used_vector_search"] is True
    hits = body["results"]
    assert hits[0]["source_type"] == "file" and hits[0]["source_id"] == target
    assert hits[0]["keyword_score"] is not None and hits[0]["vector_score"] is not None
    assert all("secret" not in h["content"] for h in hits)
    assert any(h["source_type"] == "web" and h["url"] == "https://wiki.example/narwhal" for h in hits)
    assert all(h["source_id"] == target or h["source_type"] == "web" or "narwhal" not in h["content"]
               for h in hits)

    outsider_hits = (await api.post("/api/v1/search/documents", headers=outsider.headers,
                                    json={"query": "narwhal population"})).json()["results"]
    assert outsider_hits and all(h["source_id"] != target for h in outsider_hits)
    assert all(h["source_type"] == "file" for h in outsider_hits)

    assert (await api.delete(f"/api/v1/files/{target}", headers=owner.headers)).status_code == 204
    after = (await api.post("/api/v1/search/documents", headers=owner.headers,
                            json={"query": "narwhal population"})).json()["results"]
    assert all(h["source_id"] != target for h in after)
