from __future__ import annotations

import json

import httpx
import pytest
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.exceptions import (
    ModelNotConfigured,
    ModelOutputInvalid,
    ModelRateLimited,
    ModelRequestRejected,
    ModelUnavailable,
)
from app.model_gateway.providers.gemini import GeminiProvider, to_provider_schema
from app.model_gateway.providers.scripted import ScriptedProvider
from app.model_gateway.router import ModelRouter, parse_structured
from app.model_gateway.types import CallMetadata, Message, ModelRequest


class Out(BaseModel):
    answer: str
    n: int


def req(**kw: object) -> ModelRequest:
    return ModelRequest(system="sys", messages=[Message(role="user", text="hi")],
                        metadata=CallMetadata(purpose="test"), **kw)  # type: ignore[arg-type]


def gemini(handler) -> GeminiProvider:  # type: ignore[no-untyped-def]
    settings = get_settings().model_copy(update={"gemini_api_key": get_settings().gemini_api_key.__class__("k")})
    return GeminiProvider(settings, http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


async def test_gemini_request_format_and_usage() -> None:
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-goog-api-key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": '{"answer": "ok", "n": 1}'}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 10, "candidatesTokenCount": 5, "totalTokenCount": 15},
            "responseId": "r1"})

    provider = gemini(handler)
    resp = await provider.generate(req(response_schema=Out.model_json_schema(), json_mode=True), "gemini-2.5-flash")
    assert seen["url"].endswith("/models/gemini-2.5-flash:generateContent")
    assert seen["key"] == "k"
    assert seen["body"]["systemInstruction"]["parts"][0]["text"] == "sys"
    assert seen["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert "$defs" not in json.dumps(seen["body"]["generationConfig"]["responseJsonSchema"])
    assert resp.usage.input_tokens == 10 and resp.usage.output_tokens == 5 and resp.provider_request_id == "r1"


async def test_gemini_schema_fallback_and_error_mapping() -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        calls.append("responseJsonSchema" in body["generationConfig"])
        if "responseJsonSchema" in body["generationConfig"]:
            return httpx.Response(400, json={"error": {"status": "INVALID_ARGUMENT", "message": "bad schema"}})
        return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "{}"}]}}]})

    provider = gemini(handler)
    await provider.generate(req(response_schema=Out.model_json_schema()), "m")
    assert calls == [True, False]

    for status, exc in ((429, ModelRateLimited), (503, ModelUnavailable), (403, ModelNotConfigured), (401, ModelNotConfigured),
                        (404, ModelUnavailable),
                        (400, ModelRequestRejected)):
        p = gemini(lambda r, s=status: httpx.Response(s, json={"error": {"status": "X"}}))
        with pytest.raises(exc):
            await p.generate(req(), "m")

    blocked = gemini(lambda r: httpx.Response(200, json={"promptFeedback": {"blockReason": "SAFETY"}}))
    with pytest.raises(ModelRequestRejected):
        await blocked.generate(req(), "m")


async def test_gemini_requires_key() -> None:
    settings = get_settings().model_copy(update={"gemini_api_key": get_settings().gemini_api_key.__class__("")})
    with pytest.raises(ModelNotConfigured):
        await GeminiProvider(settings).generate(req(), "m")


def test_provider_schema_inlines_refs() -> None:
    class Inner(BaseModel):
        x: int

    class Outer(BaseModel):
        items: list[Inner]

    schema = to_provider_schema(Outer.model_json_schema())
    assert "$ref" not in json.dumps(schema) and schema["properties"]["items"]["items"]["properties"]["x"]


async def test_structured_output_repair_loop() -> None:
    replies = iter(['not json', '{"answer": "x"}', '{"answer": "fixed", "n": 3}'])
    router = ModelRouter(ScriptedProvider(lambda r: next(replies)), usage_sink=None)
    out, responses = await router.generate_structured(req(), Out, max_repairs=2)
    assert out.n == 3 and len(responses) == 3


async def test_structured_output_fails_safely() -> None:
    router = ModelRouter(ScriptedProvider(lambda r: "nope"), usage_sink=None)
    with pytest.raises(ModelOutputInvalid):
        await router.generate_structured(req(), Out, max_repairs=1)


async def test_router_retries_then_falls_back() -> None:
    seen: list[str] = []

    class Flaky(ScriptedProvider):
        async def generate(self, request, model):  # type: ignore[no-untyped-def]
            seen.append(model)
            if model == get_settings().gemini_default_model:
                raise ModelUnavailable(details={"retryable": True})
            return await super().generate(request, model)

    router = ModelRouter(Flaky(lambda r: '{"answer":"a","n":1}'), usage_sink=None,
                         settings=get_settings().model_copy(update={"model_max_retries": 1}))
    response = await router.generate(req())
    assert response.model == get_settings().gemini_fast_model
    assert seen.count(get_settings().gemini_default_model) == 2


def test_parse_structured_tolerates_fences() -> None:
    assert parse_structured('```json\n{"answer": "a", "n": 2}\n```', Out).n == 2


async def test_router_fails_fast_when_provider_not_configured() -> None:
    """Missing/rejected credentials are permanent: no retries and no fallback to other models."""
    seen: list[str] = []

    class Unconfigured(ScriptedProvider):
        async def generate(self, request, model):  # type: ignore[no-untyped-def]
            seen.append(model)
            raise ModelNotConfigured()

    router = ModelRouter(Unconfigured(lambda r: "{}"), usage_sink=None,
                         settings=get_settings().model_copy(update={"model_max_retries": 3}))
    with pytest.raises(ModelNotConfigured):
        await router.generate(req())
    assert seen == [get_settings().gemini_default_model]
