"""Web search providers. All provider-specific code lives in this module.

Providers call fixed, operator-configured API endpoints (not user-chosen URLs),
with explicit timeouts and typed error mapping. Results are returned raw-ish
(``SearchResult``); normalization, dedupe and ranking happen in the service.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Protocol

import httpx
from pydantic import BaseModel, Field

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    IntegrationBadRequest,
    IntegrationError,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
)

logger = logging.getLogger(__name__)

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"
GOOGLE_CSE_URL = "https://www.googleapis.com/customsearch/v1"
_MAX_RESPONSE_BYTES = 2 * 1024 * 1024


class SearchResult(BaseModel):
    title: str
    url: str
    snippet: str = ""
    provider: str
    rank: int = Field(ge=1)
    published_at: datetime | None = None


class SearchProvider(Protocol):
    name: str

    async def search(self, query: str, max_results: int) -> list[SearchResult]: ...


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _retry_after(response: httpx.Response) -> int | None:
    value = response.headers.get("retry-after")
    try:
        return max(1, int(float(value))) if value else None
    except ValueError:
        return None


class _HttpSearchProvider:
    name = "http"

    def __init__(self, *, timeout: float, client: httpx.AsyncClient | None = None,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.timeout = timeout
        self._client = client
        self._transport = transport

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout, transport=self._transport,
                                             follow_redirects=False, trust_env=True)
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def _get_json(self, url: str, *, params: dict[str, Any], headers: dict[str, str]) -> dict[str, Any]:
        try:
            response = await self._http().get(url, params=params, headers=headers, timeout=self.timeout)
        except httpx.TimeoutException as exc:
            raise IntegrationTimeout("The search provider did not respond in time.",
                                     provider=self.name) from exc
        except httpx.HTTPError as exc:
            raise IntegrationUnavailable("The search provider is unreachable.", provider=self.name,
                                         details={"reason": type(exc).__name__}) from exc
        self._raise_for_status(response)
        if len(response.content) > _MAX_RESPONSE_BYTES:
            raise IntegrationError("The search provider response was too large.", provider=self.name)
        try:
            data = response.json()
        except ValueError as exc:
            raise IntegrationError("The search provider returned malformed data.",
                                   provider=self.name) from exc
        if not isinstance(data, dict):
            raise IntegrationError("The search provider returned malformed data.", provider=self.name)
        return data

    def _raise_for_status(self, response: httpx.Response) -> None:
        status = response.status_code
        if status < 400:
            return
        logger.warning("search provider error", extra={"provider": self.name, "status": status})
        if status == 429:
            retry_after = _retry_after(response)
            raise IntegrationRateLimited(provider=self.name, status=status,
                                         details={"retry_after": retry_after} if retry_after else None)
        if status in (401, 403):
            raise IntegrationUnavailable("The search provider rejected the configured credentials or quota.",
                                         provider=self.name, status=status)
        if status >= 500:
            raise IntegrationUnavailable(provider=self.name, status=status)
        raise IntegrationBadRequest("The search provider rejected the query.", provider=self.name,
                                    status=status)


class BraveSearchProvider(_HttpSearchProvider):
    name = "brave"

    def __init__(self, api_key: str, *, timeout: float = 15.0, client: httpx.AsyncClient | None = None,
                 transport: httpx.AsyncBaseTransport | None = None, base_url: str = BRAVE_SEARCH_URL) -> None:
        super().__init__(timeout=timeout, client=client, transport=transport)
        self._api_key = api_key
        self.base_url = base_url

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        count = max(1, min(int(max_results), 20))
        data = await self._get_json(
            self.base_url,
            params={"q": query, "count": count, "safesearch": "moderate", "text_decorations": "false"},
            headers={"Accept": "application/json", "X-Subscription-Token": self._api_key},
        )
        items = ((data.get("web") or {}).get("results") or []) if isinstance(data.get("web"), dict) else []
        results: list[SearchResult] = []
        for item in items:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            results.append(SearchResult(
                title=str(item.get("title") or ""), url=str(item["url"]),
                snippet=str(item.get("description") or ""), provider=self.name, rank=len(results) + 1,
                published_at=_parse_datetime(item.get("page_age")),
            ))
            if len(results) >= count:
                break
        return results


class GoogleCSEProvider(_HttpSearchProvider):
    name = "google_cse"
    _PAGE_SIZE = 10

    def __init__(self, api_key: str, cse_id: str, *, timeout: float = 15.0,
                 client: httpx.AsyncClient | None = None, transport: httpx.AsyncBaseTransport | None = None,
                 base_url: str = GOOGLE_CSE_URL) -> None:
        super().__init__(timeout=timeout, client=client, transport=transport)
        self._api_key = api_key
        self._cse_id = cse_id
        self.base_url = base_url

    async def search(self, query: str, max_results: int) -> list[SearchResult]:
        wanted = max(1, min(int(max_results), 20))
        results: list[SearchResult] = []
        start = 1
        while len(results) < wanted:
            num = min(self._PAGE_SIZE, wanted - len(results))
            data = await self._get_json(
                self.base_url,
                params={"key": self._api_key, "cx": self._cse_id, "q": query, "num": num, "start": start,
                        "safe": "active"},
                headers={"Accept": "application/json"},
            )
            items = data.get("items") or []
            if not isinstance(items, list) or not items:
                break
            for item in items:
                if not isinstance(item, dict) or not item.get("link"):
                    continue
                results.append(SearchResult(
                    title=str(item.get("title") or ""), url=str(item["link"]),
                    snippet=str(item.get("snippet") or ""), provider=self.name, rank=len(results) + 1,
                    published_at=_google_published(item),
                ))
            if len(items) < num:
                break
            start += len(items)
        return results[:wanted]


def _google_published(item: dict[str, Any]) -> datetime | None:
    pagemap = item.get("pagemap")
    if not isinstance(pagemap, dict):
        return None
    metatags = pagemap.get("metatags")
    if not isinstance(metatags, list) or not metatags or not isinstance(metatags[0], dict):
        return None
    tags = metatags[0]
    return _parse_datetime(tags.get("article:published_time") or tags.get("og:updated_time"))


def build_search_provider(settings: Settings | None = None) -> SearchProvider | None:
    settings = settings or get_settings()
    api_key = settings.search_api_key.get_secret_value()
    if settings.search_provider == "none" or not api_key:
        return None
    if settings.search_provider == "brave":
        return BraveSearchProvider(api_key, timeout=settings.search_timeout_seconds)
    if settings.search_provider == "google_cse":
        if not settings.google_cse_id:
            return None
        return GoogleCSEProvider(api_key, settings.google_cse_id, timeout=settings.search_timeout_seconds)
    return None


_UNSET: Any = object()
_provider: Any = _UNSET


def get_search_provider() -> SearchProvider | None:
    global _provider
    if _provider is _UNSET:
        _provider = build_search_provider(get_settings())
    return _provider  # type: ignore[no-any-return]


def set_search_provider(provider: SearchProvider | None) -> None:
    global _provider
    _provider = provider


def reset_search_provider() -> None:
    global _provider
    _provider = _UNSET
