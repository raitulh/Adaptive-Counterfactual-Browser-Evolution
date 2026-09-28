"""Web search providers over httpx.MockTransport: parsing, pagination, typed errors, factory."""

from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest
from pydantic import SecretStr

from app.core.config import get_settings
from app.core.exceptions import (
    IntegrationBadRequest,
    IntegrationError,
    IntegrationRateLimited,
    IntegrationTimeout,
    IntegrationUnavailable,
)
from app.search.providers import (
    BRAVE_SEARCH_URL,
    GOOGLE_CSE_URL,
    BraveSearchProvider,
    GoogleCSEProvider,
    build_search_provider,
)

Handler = Callable[[httpx.Request], httpx.Response]


def _brave(handler: Handler) -> BraveSearchProvider:
    return BraveSearchProvider("brave-key", timeout=5, transport=httpx.MockTransport(handler))


async def test_brave_parses_results_and_sends_credentials() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"web": {"results": [
            {"title": "Python", "url": "https://python.org/", "description": "The language",
             "page_age": "2024-05-01T10:00:00Z"},
            {"title": "no url"},
            {"title": "Docs", "url": "https://docs.python.org/3/", "description": "Documentation"},
        ]}})

    provider = _brave(handler)
    results = await provider.search("python docs", 5)
    request = seen[0]
    assert str(request.url).startswith(BRAVE_SEARCH_URL)
    assert request.headers["X-Subscription-Token"] == "brave-key"
    assert request.url.params["q"] == "python docs" and request.url.params["count"] == "5"
    assert [(r.rank, r.url, r.provider) for r in results] == [
        (1, "https://python.org/", "brave"), (2, "https://docs.python.org/3/", "brave")]
    assert results[0].published_at is not None and results[0].published_at.year == 2024
    await provider.aclose()


async def test_brave_handles_missing_web_section() -> None:
    assert await _brave(lambda r: httpx.Response(200, json={"query": {}})).search("q", 3) == []


async def test_google_cse_paginates() -> None:
    starts: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url).startswith(GOOGLE_CSE_URL)
        assert request.url.params["key"] == "g-key" and request.url.params["cx"] == "cse-id"
        start = int(request.url.params["start"])
        num = int(request.url.params["num"])
        starts.append(str(start))
        items = [{"title": f"R{start + i}", "link": f"https://site{start + i}.example/", "snippet": "s",
                  "pagemap": {"metatags": [{"article:published_time": "2023-01-02T00:00:00+00:00"}]}}
                 for i in range(num)]
        return httpx.Response(200, json={"items": items})

    provider = GoogleCSEProvider("g-key", "cse-id", transport=httpx.MockTransport(handler))
    results = await provider.search("q", 15)
    assert starts == ["1", "11"]
    assert [r.rank for r in results] == list(range(1, 16))
    assert results[0].published_at is not None
    assert {r.provider for r in results} == {"google_cse"}


async def test_google_cse_stops_when_no_items() -> None:
    provider = GoogleCSEProvider("k", "cx", transport=httpx.MockTransport(lambda r: httpx.Response(200, json={})))
    assert await provider.search("q", 10) == []


@pytest.mark.parametrize(("response", "error"), [
    (httpx.Response(429, headers={"Retry-After": "7"}), IntegrationRateLimited),
    (httpx.Response(401), IntegrationUnavailable),
    (httpx.Response(403), IntegrationUnavailable),
    (httpx.Response(400), IntegrationBadRequest),
    (httpx.Response(503), IntegrationUnavailable),
    (httpx.Response(200, content=b"not json"), IntegrationError),
    (httpx.Response(200, json=[1, 2]), IntegrationError),
])
async def test_brave_maps_http_errors(response: httpx.Response, error: type[Exception]) -> None:
    with pytest.raises(error) as exc:
        await _brave(lambda r: response).search("q", 3)
    if isinstance(exc.value, IntegrationRateLimited):
        assert exc.value.details["retry_after"] == 7
    assert "brave-key" not in str(exc.value.details)


async def test_timeouts_and_network_errors_are_typed() -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    def refused(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    with pytest.raises(IntegrationTimeout):
        await _brave(timeout).search("q", 3)
    with pytest.raises(IntegrationUnavailable):
        await _brave(refused).search("q", 3)


def test_build_search_provider() -> None:
    base = get_settings()
    assert build_search_provider(base.model_copy(update={"search_provider": "none"})) is None
    assert build_search_provider(base.model_copy(update={"search_provider": "brave",
                                                         "search_api_key": SecretStr("")})) is None
    brave = build_search_provider(base.model_copy(update={"search_provider": "brave",
                                                          "search_api_key": SecretStr("k")}))
    assert isinstance(brave, BraveSearchProvider) and brave.name == "brave"
    assert build_search_provider(base.model_copy(update={"search_provider": "google_cse",
                                                         "search_api_key": SecretStr("k"),
                                                         "google_cse_id": ""})) is None
    google = build_search_provider(base.model_copy(update={"search_provider": "google_cse",
                                                           "search_api_key": SecretStr("k"),
                                                           "google_cse_id": "cx", "search_timeout_seconds": 3}))
    assert isinstance(google, GoogleCSEProvider) and google.timeout == 3
