"""Search pipelines.

Web search: query → provider retrieval → normalization → canonical-URL dedupe →
ranking → citation metadata → persisted ``SearchDocument`` rows → usage.

Document search: hybrid retrieval over the tenant's indexed chunks (PostgreSQL
full-text ``ts_rank_cd`` + optional pgvector cosine similarity), fused with
reciprocal-rank fusion and confined to the tenant and the caller's own files.

Network IO (provider calls, embeddings, page fetches) always happens before any
database statement of the same call, so no transaction is held across it.
"""

from __future__ import annotations

import hashlib
import html
import logging
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import and_, delete, func, insert, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.sanitize import clean_text
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.exceptions import (
    ConfigurationMissing,
    IntegrationError,
    IntegrationNotFound,
    ValidationFailed,
)
from app.model_gateway.types import CallMetadata
from app.search.models import EMBEDDING_DIMENSIONS, SearchChunk, SearchDocument, SourceType
from app.search.providers import SearchProvider, SearchResult
from app.search.schemas import (
    Citation,
    DocumentSearchHit,
    DocumentSearchResponse,
    FetchedPage,
    WebSearchHit,
    WebSearchResponse,
)
from app.security.http import safe_request
from app.security.ssrf import EgressPolicy
from app.usage.models import UsageKind
from app.usage.service import add_usage

logger = logging.getLogger(__name__)

MAX_QUERY_CHARS = 400
MAX_WEB_RESULTS = 20
_RRF_K = 60

# ---------------------------------------------------------------------------- text helpers
# HTML handling is a single forward scan with ``str.find`` / anchored regexes only: web pages
# and uploaded files are attacker controlled, and backtracking patterns such as
# ``<(nav)>.*?</\1>`` or ``<[^>]+>`` degrade quadratically on inputs like ``"<nav>" * 10**5``.
_TAG_NAME = re.compile(r"/?([A-Za-z][A-Za-z0-9:-]{0,40})")
_RAW_TEXT_TAGS = frozenset({"script", "style", "title", "textarea", "xmp", "noscript", "iframe", "noembed",
                            "noframes"})
_RAW_TEXT_END = {tag: re.compile(rf"</{tag}\b", re.I) for tag in _RAW_TEXT_TAGS}
_DROP_TAGS = frozenset({"svg", "math", "template", "nav", "footer", "object", "select", "datalist"})
_BLOCK_TAGS = frozenset({
    "address", "article", "aside", "blockquote", "body", "br", "caption", "dd", "details", "div", "dl", "dt",
    "fieldset", "figcaption", "figure", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "html",
    "legend", "li", "main", "ol", "p", "pre", "section", "summary", "table", "tbody", "thead", "tfoot", "tr",
    "ul",
})
_CELL_TAGS = frozenset({"td", "th"})
_TITLE_START = re.compile(r"<title\b", re.I)
_INLINE_WS = re.compile(r"[ \t\r\f\v\xa0​]+")
_MANY_NEWLINES = re.compile(r"\n{3,}")
# Only the ``<`` of a would-be prompt-boundary tag is neutralised here, in linear time, so the
# shared sanitizer's ``<tag[^>]*>`` pattern never has to scan an unterminated tag.
_BOUNDARY_PREFIX = re.compile(
    r"<(?=[ \t]*/?[ \t]*(?:untrusted_content|system_policy|agent_policy|user_instruction|tool_result))", re.I)
_TERM = re.compile(r"[^\W_]+", re.U)
_STOP_TEXT = ("a an and are as at be by for from how in is it of on or that the this to was what when where "
              "which who why with")
_STOP = frozenset(_STOP_TEXT.split())


def clean_untrusted_text(text: str, *, max_chars: int) -> str:
    """``clean_text`` for large untrusted inputs, made linear-time and without a truncation suffix."""
    text = _BOUNDARY_PREFIX.sub("[removed-boundary-tag] ", text)
    return clean_text(text, max_chars=max(max_chars, len(text) + 1))[:max_chars]


def _collapse_lines(text: str) -> str:
    lines = (_INLINE_WS.sub(" ", line).strip() for line in text.split("\n"))
    return _MANY_NEWLINES.sub("\n\n", "\n".join(lines)).strip()


def _skip_past(document: str, needle: str, start: int) -> int:
    idx = document.find(needle, start)
    return len(document) if idx == -1 else idx + len(needle)


def html_to_text(document: str) -> str:
    """Readable text from HTML in one linear pass: drops comments, scripts, styles, the title
    and navigation/SVG/templates, turns block boundaries into line breaks, removes every tag and
    unescapes entities. The result is plain text (untrusted data), not sanitized markup."""
    out: list[str] = []
    n = len(document)
    pos = 0
    drop_depth: dict[str, int] = {}
    pre_depth = 0
    dropping = False

    def emit(chunk: str) -> None:
        if not dropping and chunk:
            text = html.unescape(chunk)
            out.append(text if pre_depth else text.replace("\n", " "))

    while pos < n:
        lt = document.find("<", pos)
        if lt == -1:
            emit(document[pos:])
            break
        emit(document[pos:lt])
        nxt = document[lt + 1:lt + 2]
        if document.startswith("<!--", lt):
            pos = _skip_past(document, "-->", lt + 4)
            continue
        if nxt in ("!", "?"):
            pos = _skip_past(document, ">", lt + 2)
            continue
        match = _TAG_NAME.match(document, lt + 1)
        if match is None:  # a literal "<" in text, e.g. "a < b"
            emit("<")
            pos = lt + 1
            continue
        gt = document.find(">", match.end())
        if gt == -1:  # unterminated tag at EOF: browsers drop it
            break
        pos = gt + 1
        name = match.group(1).lower()
        closing = document[lt + 1] == "/"
        self_closing = document[gt - 1] == "/"
        if closing:
            if name in _DROP_TAGS and drop_depth.get(name, 0) > 0:
                drop_depth[name] -= 1
                dropping = any(drop_depth.values())
            elif name == "pre" and pre_depth:
                pre_depth -= 1
        elif name in _RAW_TEXT_TAGS and not self_closing:
            end = _RAW_TEXT_END[name].search(document, pos)
            pos = n if end is None else _skip_past(document, ">", end.end())
        elif name in _DROP_TAGS and not self_closing:
            drop_depth[name] = drop_depth.get(name, 0) + 1
            dropping = True
        elif name == "pre" and not self_closing:
            pre_depth += 1
        if name in _BLOCK_TAGS:
            out.append("\n")
        elif name in _CELL_TAGS:
            out.append(" ")
    return _collapse_lines("".join(out))


def extract_html_title(document: str) -> str | None:
    """Text of the first ``<title>`` element (bounded, linear scan)."""
    head = document[:500_000]
    start = _TITLE_START.search(head)
    if start is None:
        return None
    gt = head.find(">", start.end())
    if gt == -1:
        return None
    end = _RAW_TEXT_END["title"].search(head, gt + 1)
    raw = head[gt + 1:end.start() if end is not None else min(len(head), gt + 1 + 2000)]
    title = _INLINE_WS.sub(" ", html.unescape(raw[:2000]).replace("\n", " ")).strip()
    title = clean_untrusted_text(title, max_chars=300)
    return title or None


def plain_text_from_markup(value: str, *, max_chars: int) -> str:
    """Provider titles/snippets may carry ``<b>`` highlights and entities: strip them to one line."""
    return clean_untrusted_text(html_to_text(value[: max_chars * 4]), max_chars=max_chars).replace("\n", " ")


def normalize_query(query: str) -> str:
    cleaned = clean_untrusted_text((query or "")[: MAX_QUERY_CHARS * 4], max_chars=MAX_QUERY_CHARS * 2)
    cleaned = cleaned.replace("\n", " ")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()[:MAX_QUERY_CHARS]
    if not cleaned:
        raise ValidationFailed("The search query is empty.", code="empty_query")
    return cleaned


def query_terms(text: str) -> set[str]:
    return {t for t in _TERM.findall(text.lower()) if t not in _STOP and len(t) > 1}


# ---------------------------------------------------------------------------- canonical URLs
_TRACKING_PARAMS = frozenset({
    "gclid", "gclsrc", "dclid", "fbclid", "msclkid", "yclid", "twclid", "ttclid", "li_fat_id", "igshid",
    "mc_cid", "mc_eid", "_hsenc", "_hsmi", "hsctatracking", "mkt_tok", "oly_anon_id", "oly_enc_id", "vero_id",
    "vero_conv", "_ga", "_gl", "gbraid", "wbraid", "s_cid", "ref_src", "spm", "rb_clickid", "wickedid",
})
_TRACKING_PREFIXES = ("utm_", "pk_", "mtm_", "hmb_")


def canonicalize_url(url: str) -> str | None:
    """Canonical form used for dedupe and document identity: http(s) only, lowercase
    scheme/host, default port dropped, no credentials, no fragment, tracking params removed
    and the remaining query parameters sorted."""
    try:
        parts = urlsplit((url or "").strip())
        scheme = parts.scheme.lower()
        host = (parts.hostname or "").lower().rstrip(".")
        port = parts.port
    except ValueError:
        return None
    if scheme not in ("http", "https") or not host:
        return None
    if ":" in host:
        host = f"[{host}]"
    if port is not None and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        host = f"{host}:{port}"
    params = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
              if k.lower() not in _TRACKING_PARAMS and not k.lower().startswith(_TRACKING_PREFIXES)]
    query = urlencode(sorted(params), doseq=True)
    path = parts.path or "/"
    return urlunsplit((scheme, host, path, query, ""))


def url_hash(canonical_url: str) -> str:
    return hashlib.sha256(canonical_url.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------- ranking
@dataclass(slots=True)
class _Candidate:
    result: SearchResult
    canonical_url: str
    title: str
    snippet: str
    relevance: float = 0.0


def _relevance(query: set[str], title: str, snippet: str, provider_rank: int) -> float:
    provider_score = 1.0 / (1.0 + 0.1 * (provider_rank - 1))
    if not query:
        return round(provider_score, 4)
    title_terms, body_terms = query_terms(title), query_terms(snippet)
    overlap = len(query & (title_terms | body_terms)) / len(query)
    title_overlap = len(query & title_terms) / len(query)
    return round(0.55 * provider_score + 0.3 * overlap + 0.15 * title_overlap, 4)


def process_results(query: str, raw: Sequence[SearchResult], *, max_results: int,
                    retrieved_at: datetime | None = None) -> list[WebSearchHit]:
    """Normalize, dedupe by canonical URL, rank and attach citation metadata."""
    retrieved_at = retrieved_at or utcnow()
    terms = query_terms(query)
    by_url: dict[str, _Candidate] = {}
    for item in sorted(raw, key=lambda r: r.rank):
        canonical = canonicalize_url(item.url)
        if canonical is None:
            continue
        title = plain_text_from_markup(item.title, max_chars=300) or canonical
        snippet = plain_text_from_markup(item.snippet, max_chars=1000)
        existing = by_url.get(canonical)
        if existing is not None:
            if not existing.snippet and snippet:
                existing.snippet = snippet
            continue
        by_url[canonical] = _Candidate(result=item, canonical_url=canonical, title=title, snippet=snippet)
    candidates = list(by_url.values())
    for cand in candidates:
        cand.relevance = _relevance(terms, cand.title, cand.snippet, cand.result.rank)
    candidates.sort(key=lambda c: (-c.relevance, c.result.rank))
    hits: list[WebSearchHit] = []
    for position, cand in enumerate(candidates[:max_results], start=1):
        hits.append(WebSearchHit(
            rank=position, title=cand.title, url=cand.canonical_url, snippet=cand.snippet,
            provider=cand.result.provider, provider_rank=cand.result.rank, relevance=cand.relevance,
            retrieved_at=retrieved_at, published_at=cand.result.published_at,
            citation=Citation(source_url=cand.canonical_url, title=cand.title, provider=cand.result.provider,
                              retrieved_at=retrieved_at, relevance=cand.relevance),
        ))
    return hits


# ---------------------------------------------------------------------------- web search
async def retrieve_web_results(provider: SearchProvider | None, query: str, max_results: int
                               ) -> tuple[str, list[WebSearchHit]]:
    """Provider call + processing, no database access."""
    if provider is None:
        raise ConfigurationMissing("Web search is not configured on this server.",
                                   details={"feature": "web_search"})
    normalized = normalize_query(query)
    wanted = max(1, min(int(max_results), MAX_WEB_RESULTS))
    raw = await provider.search(normalized, min(MAX_WEB_RESULTS, wanted + 5))
    return normalized, process_results(normalized, raw, max_results=wanted)


async def persist_web_documents(session: AsyncSession, *, tenant_id: uuid.UUID, hits: list[WebSearchHit]
                                ) -> None:
    """Upsert one tenant-shared ``SearchDocument`` per canonical URL and attach ids to hits."""
    if not hits:
        return
    rows = [{
        "tenant_id": tenant_id, "user_id": None, "source_type": SourceType.WEB,
        "source_id": url_hash(hit.url), "url": hit.url, "title": hit.title[:500], "provider": hit.provider,
        "snippet": hit.snippet,
        "content_hash": hashlib.sha256(f"{hit.title}\n{hit.snippet}".encode()).hexdigest(),
        "retrieved_at": hit.retrieved_at,
        "metadata_": {"provider_rank": hit.provider_rank,
                      "published_at": hit.published_at.isoformat() if hit.published_at else None},
    } for hit in hits]
    ins = pg_insert(SearchDocument).values(rows)
    upsert = ins.on_conflict_do_update(
        index_elements=["tenant_id", "source_type", "source_id"],
        set_={"url": ins.excluded.url, "title": ins.excluded.title, "provider": ins.excluded.provider,
              "snippet": ins.excluded.snippet, "content_hash": ins.excluded.content_hash,
              "retrieved_at": ins.excluded.retrieved_at, "metadata": ins.excluded["metadata"],
              "updated_at": func.now()},
    ).returning(SearchDocument.id, SearchDocument.source_id)
    ids = {row.source_id: row.id for row in (await session.execute(upsert)).all()}
    for hit in hits:
        hit.document_id = ids.get(url_hash(hit.url))


async def web_search(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, query: str,
                     max_results: int, provider: SearchProvider | None) -> WebSearchResponse:
    """Full web-search pipeline. The provider call happens before any statement on
    ``session``; callers must not hold an open transaction when calling this."""
    normalized, hits = await retrieve_web_results(provider, query, max_results)
    assert provider is not None
    await persist_web_documents(session, tenant_id=tenant_id, hits=hits)
    add_usage(session, tenant_id=tenant_id, user_id=user_id, kind=UsageKind.SEARCH_QUERY,
              metadata={"provider": provider.name, "results": len(hits)})
    await session.commit()
    return WebSearchResponse(query=normalized, provider=provider.name,
                             retrieved_at=hits[0].retrieved_at if hits else utcnow(), results=hits)


# ---------------------------------------------------------------------------- indexing
@dataclass(frozen=True, slots=True)
class IndexChunk:
    content: str
    char_start: int | None = None
    char_end: int | None = None


async def index_document(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID | None,
                         source_type: str, source_id: str, title: str, chunks: Sequence[IndexChunk],
                         embeddings: Sequence[Sequence[float] | None] | None = None, url: str | None = None,
                         provider: str | None = None, snippet: str | None = None,
                         content_hash: str | None = None, metadata: dict[str, Any] | None = None
                         ) -> uuid.UUID:
    """Upsert a document and *replace* its chunks (idempotent re-indexing)."""
    ins = pg_insert(SearchDocument).values(
        tenant_id=tenant_id, user_id=user_id, source_type=source_type, source_id=source_id, url=url,
        title=title[:500], provider=provider, snippet=snippet, content_hash=content_hash,
        retrieved_at=utcnow(), metadata_=metadata or {},
    )
    upsert = ins.on_conflict_do_update(
        index_elements=["tenant_id", "source_type", "source_id"],
        set_={"user_id": ins.excluded.user_id, "url": ins.excluded.url, "title": ins.excluded.title,
              "provider": ins.excluded.provider, "snippet": ins.excluded.snippet,
              "content_hash": ins.excluded.content_hash, "retrieved_at": ins.excluded.retrieved_at,
              "metadata": ins.excluded["metadata"], "updated_at": func.now()},
    ).returning(SearchDocument.id)
    document_id: uuid.UUID = (await session.execute(upsert)).scalar_one()
    await session.execute(delete(SearchChunk).where(SearchChunk.tenant_id == tenant_id,
                                                    SearchChunk.document_id == document_id))
    if chunks:
        vectors = list(embeddings) if embeddings is not None else []
        rows = []
        for index, chunk in enumerate(chunks):
            vector = vectors[index] if index < len(vectors) else None
            rows.append({
                "tenant_id": tenant_id, "document_id": document_id, "chunk_index": index,
                "content": chunk.content, "char_start": chunk.char_start, "char_end": chunk.char_end,
                "embedding": (list(vector) if vector is not None and len(vector) == EMBEDDING_DIMENSIONS
                              else None),
            })
        for offset in range(0, len(rows), 500):
            await session.execute(insert(SearchChunk), rows[offset:offset + 500])
    return document_id


async def delete_documents_for_sources(session: AsyncSession, *, tenant_id: uuid.UUID, source_type: str,
                                       source_ids: Sequence[str]) -> int:
    """Remove documents (chunks and embeddings cascade) derived from the given sources."""
    if not source_ids:
        return 0
    result = await session.execute(delete(SearchDocument).where(
        SearchDocument.tenant_id == tenant_id, SearchDocument.source_type == source_type,
        SearchDocument.source_id.in_(list(source_ids))))
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


async def delete_user_documents(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID) -> int:
    """Right-to-delete: remove every document owned by a user in a tenant."""
    result = await session.execute(delete(SearchDocument).where(SearchDocument.tenant_id == tenant_id,
                                                                SearchDocument.user_id == user_id))
    return int(result.rowcount or 0)  # type: ignore[attr-defined]


async def load_document_chunks(session: AsyncSession, *, tenant_id: uuid.UUID, source_type: str,
                               source_id: str) -> list[tuple[str, int | None, int | None]]:
    """``(content, char_start, char_end)`` of a document's chunks in order."""
    rows = (await session.execute(
        select(SearchChunk.content, SearchChunk.char_start, SearchChunk.char_end)
        .join(SearchDocument, SearchDocument.id == SearchChunk.document_id)
        .where(SearchDocument.tenant_id == tenant_id, SearchDocument.source_type == source_type,
               SearchDocument.source_id == source_id)
        .order_by(SearchChunk.chunk_index)
    )).all()
    return [(r.content, r.char_start, r.char_end) for r in rows]


# ---------------------------------------------------------------------------- document search
async def _embed_query(model_router: Any, query: str, tenant_id: uuid.UUID, user_id: uuid.UUID
                       ) -> list[float] | None:
    if model_router is None:
        return None
    try:
        vectors = await model_router.embed(
            [query], task_type="RETRIEVAL_QUERY",
            metadata=CallMetadata(purpose="search.documents", tenant_id=tenant_id, user_id=user_id))
    except Exception as exc:  # vector search is optional; keyword search still answers
        logger.warning("query embedding unavailable", extra={"error": type(exc).__name__})
        return None
    if not vectors or len(vectors[0]) != EMBEDDING_DIMENSIONS:
        return None
    return list(vectors[0])


def _visible_documents(tenant_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    return and_(
        SearchDocument.tenant_id == tenant_id,
        or_(SearchDocument.user_id == user_id,
            and_(SearchDocument.user_id.is_(None), SearchDocument.source_type != SourceType.FILE)),
    )


async def search_documents(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, query: str,
                           limit: int = 10, model_router: Any | None = None) -> DocumentSearchResponse:
    """Hybrid keyword + vector search over indexed chunks the caller may see."""
    normalized = normalize_query(query)
    limit = max(1, min(int(limit), 50))
    query_vector = await _embed_query(model_router, normalized, tenant_id, user_id)
    visible = _visible_documents(tenant_id, user_id)
    candidates = limit * 4

    tsquery = func.websearch_to_tsquery("english", normalized)
    keyword_score = func.ts_rank_cd(SearchChunk.search_vector, tsquery)
    keyword_rows = (await session.execute(
        select(SearchChunk.id, keyword_score.label("score"))
        .join(SearchDocument, SearchDocument.id == SearchChunk.document_id)
        .where(visible, SearchChunk.tenant_id == tenant_id, SearchChunk.search_vector.op("@@")(tsquery))
        .order_by(keyword_score.desc(), SearchChunk.id)
        .limit(candidates)
    )).all()

    vector_rows: list[Any] = []
    if query_vector is not None:
        distance = SearchChunk.embedding.cosine_distance(query_vector)
        vector_rows = list((await session.execute(
            select(SearchChunk.id, (1 - distance).label("score"))
            .join(SearchDocument, SearchDocument.id == SearchChunk.document_id)
            .where(visible, SearchChunk.tenant_id == tenant_id, SearchChunk.embedding.is_not(None))
            .order_by(distance)
            .limit(candidates)
        )).all())

    fused: dict[uuid.UUID, float] = {}
    keyword_scores: dict[uuid.UUID, float] = {}
    vector_scores: dict[uuid.UUID, float] = {}
    for rank, row in enumerate(keyword_rows, start=1):
        fused[row.id] = fused.get(row.id, 0.0) + 1.0 / (_RRF_K + rank)
        keyword_scores[row.id] = float(row.score)
    for rank, row in enumerate(vector_rows, start=1):
        fused[row.id] = fused.get(row.id, 0.0) + 1.0 / (_RRF_K + rank)
        vector_scores[row.id] = float(row.score)
    top = sorted(fused, key=lambda cid: (-fused[cid], str(cid)))[:limit]
    if not top:
        return DocumentSearchResponse(query=normalized, used_vector_search=query_vector is not None,
                                      results=[])

    details = {row.id: row for row in (await session.execute(
        select(SearchChunk.id, SearchChunk.chunk_index, SearchChunk.content, SearchChunk.document_id,
               SearchDocument.source_type, SearchDocument.source_id, SearchDocument.title, SearchDocument.url)
        .join(SearchDocument, SearchDocument.id == SearchChunk.document_id)
        .where(visible, SearchChunk.id.in_(top))
    )).all()}
    hits = [
        DocumentSearchHit(
            document_id=hit.document_id, chunk_id=hit.id, source_type=hit.source_type,
            source_id=hit.source_id, title=hit.title, url=hit.url, chunk_index=hit.chunk_index,
            content=clean_text(hit.content, max_chars=1500), score=round(fused[cid], 6),
            keyword_score=keyword_scores.get(cid), vector_score=vector_scores.get(cid),
        )
        for cid in top if (hit := details.get(cid)) is not None
    ]
    return DocumentSearchResponse(query=normalized, used_vector_search=query_vector is not None, results=hits)


# ---------------------------------------------------------------------------- page fetch
_FETCHABLE_TYPES = frozenset({"text/html", "text/plain", "application/json"})


async def fetch_page(url: str, *, policy: EgressPolicy, max_chars: int = 20_000, max_bytes: int | None = None,
                     client: Any | None = None) -> FetchedPage:
    """SSRF-safe, size-capped fetch of a web page returning readable text (untrusted)."""
    settings = get_settings()
    cap = min(max_bytes or settings.outbound_max_response_bytes, settings.outbound_max_response_bytes)
    response = await safe_request(
        "GET", url, policy=policy, max_bytes=cap, client=client,
        headers={"Accept": "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,application/json;q=0.7"},
    )
    if response.status_code == 404:
        raise IntegrationNotFound("The page was not found.", provider="web", status=404)
    if response.status_code >= 400:
        raise IntegrationError("The page could not be fetched.", provider="web", status=response.status_code,
                               details={"status": response.status_code})
    content_type = response.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in _FETCHABLE_TYPES:
        raise ValidationFailed("Only HTML, plain-text and JSON pages can be fetched.",
                               code="unsupported_content_type", details={"content_type": content_type[:100]})
    body = response.text
    title: str | None = None
    if content_type == "text/html":
        title = extract_html_title(body)
        raw_text = html_to_text(body)
    else:
        raw_text = body
    full = clean_untrusted_text(raw_text.replace("\r\n", "\n"), max_chars=max_chars + 1)
    truncated = len(full) > max_chars
    return FetchedPage(
        url=url, final_url=response.url, status_code=response.status_code, content_type=content_type,
        title=title, text=full[:max_chars], truncated=truncated,
        content_sha256=hashlib.sha256(response.content).hexdigest(), retrieved_at=utcnow(),
    )
