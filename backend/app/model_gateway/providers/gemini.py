"""Gemini API provider (REST, via httpx — async, explicit timeouts, no SDK globals).

This is the only module that knows Gemini's wire format.
"""

from __future__ import annotations

import logging
import math
import time
from typing import Any

import httpx

from app.core.config import Settings, get_settings
from app.core.exceptions import (
    ModelError,
    ModelRateLimited,
    ModelRequestRejected,
    ModelTimeout,
    ModelUnavailable,
)
from app.model_gateway.types import ModelRequest, ModelResponse, ModelUsage, estimate_tokens

logger = logging.getLogger(__name__)

_UNSUPPORTED_SCHEMA_KEYS = {"title", "default", "examples", "$schema", "discriminator"}


def to_provider_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Inline ``$ref``/``$defs`` and drop keywords the structured-output endpoint rejects."""
    defs = schema.get("$defs", {})

    def walk(node: Any, depth: int = 0) -> Any:
        if depth > 30:
            return {}
        if isinstance(node, dict):
            if "$ref" in node and isinstance(node["$ref"], str) and node["$ref"].startswith("#/$defs/"):
                target = defs.get(node["$ref"].split("/")[-1], {})
                merged = {**target, **{k: v for k, v in node.items() if k != "$ref"}}
                return walk(merged, depth + 1)
            return {k: walk(v, depth + 1) for k, v in node.items()
                    if k not in _UNSUPPORTED_SCHEMA_KEYS and k != "$defs"}
        if isinstance(node, list):
            return [walk(item, depth + 1) for item in node]
        return node

    return walk(schema)


class GeminiProvider:
    name = "gemini"

    def __init__(self, settings: Settings | None = None, http: httpx.AsyncClient | None = None) -> None:
        self.settings = settings or get_settings()
        self._http = http or httpx.AsyncClient(timeout=self.settings.model_timeout_seconds)
        self._schema_unsupported: set[str] = set()

    def is_configured(self) -> bool:
        return bool(self.settings.gemini_api_key.get_secret_value())

    def _headers(self) -> dict[str, str]:
        if not self.is_configured():
            raise ModelUnavailable("GEMINI_API_KEY is not configured")
        return {"x-goog-api-key": self.settings.gemini_api_key.get_secret_value(),
                "content-type": "application/json"}

    def _body(self, request: ModelRequest, model: str, *, with_schema: bool) -> dict[str, Any]:
        config: dict[str, Any] = {
            "temperature": request.temperature,
            "maxOutputTokens": request.max_output_tokens or self.settings.model_max_output_tokens,
        }
        if request.response_schema is not None or request.json_mode:
            config["responseMimeType"] = "application/json"
            if with_schema and request.response_schema is not None and self.settings.gemini_use_json_schema:
                config["responseJsonSchema"] = to_provider_schema(request.response_schema)
        return {
            "systemInstruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": m.role, "parts": [{"text": m.text}]} for m in request.messages],
            "generationConfig": config,
        }

    async def _post(self, url: str, body: dict[str, Any], timeout: float) -> httpx.Response:
        try:
            return await self._http.post(url, json=body, headers=self._headers(), timeout=timeout)
        except httpx.TimeoutException as exc:
            raise ModelTimeout() from exc
        except httpx.HTTPError as exc:
            raise ModelUnavailable("Model provider unreachable", details={"retryable": True}) from exc

    @staticmethod
    def _raise_for_status(response: httpx.Response) -> None:
        if response.status_code == 200:
            return
        status = response.status_code
        try:
            err = response.json().get("error", {})
        except ValueError:
            err = {}
        reason = str(err.get("status", ""))
        if status == 429:
            retry_after = response.headers.get("retry-after")
            raise ModelRateLimited(details={"retry_after": int(retry_after) if retry_after and retry_after.isdigit()
                                            else None})
        if status in (500, 502, 503, 504):
            raise ModelUnavailable("Model provider temporarily unavailable",
                                   details={"status": status, "retryable": True})
        if status in (401, 403):
            raise ModelUnavailable("Model provider rejected credentials", details={"status": status})
        if status == 404:
            raise ModelUnavailable("Model not found", details={"status": status})
        raise ModelRequestRejected(details={"status": status, "reason": reason,
                                            "message": str(err.get("message", ""))[:300]})

    async def generate(self, request: ModelRequest, model: str) -> ModelResponse:
        url = f"{self.settings.gemini_base_url}/models/{model}:generateContent"
        timeout = request.timeout_seconds or self.settings.model_timeout_seconds
        with_schema = model not in self._schema_unsupported
        started = time.perf_counter()
        response = await self._post(url, self._body(request, model, with_schema=with_schema), timeout)
        if response.status_code == 400 and with_schema and request.response_schema is not None:
            # Some models reject parts of JSON Schema; fall back to JSON mode + strict local validation.
            logger.warning("structured schema rejected by provider; retrying in JSON mode", extra={"model": model})
            self._schema_unsupported.add(model)
            response = await self._post(url, self._body(request, model, with_schema=False), timeout)
        latency_ms = (time.perf_counter() - started) * 1000
        self._raise_for_status(response)
        data = response.json()
        feedback = data.get("promptFeedback") or {}
        if feedback.get("blockReason"):
            raise ModelRequestRejected("The model provider blocked the prompt",
                                       details={"block_reason": feedback.get("blockReason")})
        candidates = data.get("candidates") or []
        if not candidates:
            raise ModelError("Model returned no candidates")
        candidate = candidates[0]
        parts = (candidate.get("content") or {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
        finish = candidate.get("finishReason")
        if finish in ("SAFETY", "RECITATION", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"):
            raise ModelRequestRejected("The model provider withheld the response", details={"finish_reason": finish})
        meta = data.get("usageMetadata") or {}
        prompt_text = request.system + "".join(m.text for m in request.messages)
        usage = ModelUsage(
            input_tokens=meta.get("promptTokenCount"),
            output_tokens=(meta.get("candidatesTokenCount") or 0) + (meta.get("thoughtsTokenCount") or 0) or None,
            total_tokens=meta.get("totalTokenCount"),
            input_token_estimate=estimate_tokens(prompt_text),
            output_token_estimate=estimate_tokens(text),
        )
        return ModelResponse(text=text, model=model, provider=self.name, finish_reason=finish, usage=usage,
                             latency_ms=latency_ms, provider_request_id=data.get("responseId"),
                             status="truncated" if finish == "MAX_TOKENS" else "ok")

    async def embed(self, texts: list[str], *, task_type: str, model: str | None = None,
                    dimensions: int | None = None) -> list[list[float]]:
        model = model or self.settings.gemini_embedding_model
        dims = dimensions or self.settings.embedding_dimensions
        url = f"{self.settings.gemini_base_url}/models/{model}:batchEmbedContents"
        body = {"requests": [{"model": f"models/{model}", "content": {"parts": [{"text": t[:8000]}]},
                              "taskType": task_type, "outputDimensionality": dims} for t in texts]}
        response = await self._post(url, body, self.settings.model_timeout_seconds)
        self._raise_for_status(response)
        vectors = [e.get("values", []) for e in response.json().get("embeddings", [])]
        if len(vectors) != len(texts) or any(len(v) != dims for v in vectors):
            raise ModelError("Embedding response had an unexpected shape")
        return [_normalize(v) for v in vectors]


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(x * x for x in vector)) or 1.0
    return [x / norm for x in vector]
