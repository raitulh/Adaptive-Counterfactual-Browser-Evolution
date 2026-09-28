"""ModelRouter: the single entry point for all LLM calls.

Responsibilities: model selection by tier/policy, per-tenant rate limiting,
retries with backoff + jitter, provider fallback, timeouts, strict structured
output parsing with bounded repair, usage/cost accounting and telemetry.
Prompts and completions are never logged.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import re
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.core import metrics
from app.core.config import Settings, get_settings
from app.core.exceptions import (
    ModelError,
    ModelOutputInvalid,
    ModelRateLimited,
    ModelTimeout,
    ModelUnavailable,
)
from app.core.telemetry import span
from app.model_gateway.pricing import estimate_cost
from app.model_gateway.providers.base import ModelProvider
from app.model_gateway.types import CallMetadata, Message, ModelRequest, ModelResponse, ModelTier

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

UsageSink = Callable[[CallMetadata, ModelResponse | None, str | None], Awaitable[None]]
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.I)


class ModelRouter:
    def __init__(self, provider: ModelProvider, settings: Settings | None = None,
                 usage_sink: UsageSink | None = None, rate_limiter: Any | None = None) -> None:
        self.provider = provider
        self.settings = settings or get_settings()
        self.usage_sink = usage_sink
        self.rate_limiter = rate_limiter

    # ------------------------------------------------------------------ selection
    def model_for(self, tier: ModelTier, policy: dict[str, Any] | None = None) -> list[str]:
        """Ordered candidates (primary first, then fallbacks) for a tier, honouring an
        agent version's model policy (``{"default": "...", "fallbacks": [...]}``)."""
        s = self.settings
        by_tier = {
            ModelTier.FAST: [s.gemini_fast_model, s.gemini_default_model],
            ModelTier.DEFAULT: [s.gemini_default_model, s.gemini_fast_model],
            ModelTier.REASONING: [s.gemini_reasoning_model, s.gemini_default_model],
        }[tier]
        if policy:
            preferred = policy.get(tier.value) or policy.get("default")
            fallbacks = list(policy.get("fallbacks", []))
            if preferred:
                by_tier = [preferred, *fallbacks, *by_tier]
        return list(dict.fromkeys(m for m in by_tier if m))

    # ------------------------------------------------------------------ raw generation
    async def generate(self, request: ModelRequest, *, model_policy: dict[str, Any] | None = None) -> ModelResponse:
        if self.rate_limiter is not None and request.metadata.tenant_id is not None:
            await self.rate_limiter.enforce("model", str(request.metadata.tenant_id),
                                            self.settings.rate_limit_model_calls_per_minute)
        candidates = [request.model] if request.model else self.model_for(request.tier, model_policy)
        last_error: Exception | None = None
        for model in candidates:
            try:
                return await self._generate_with_retries(request, model)
            except (ModelUnavailable, ModelTimeout, ModelRateLimited) as exc:
                last_error = exc
                logger.warning("model fallback", extra={"model": model, "error": type(exc).__name__})
                continue
        assert last_error is not None
        raise last_error

    async def _generate_with_retries(self, request: ModelRequest, model: str) -> ModelResponse:
        attempts = self.settings.model_max_retries + 1
        for attempt in range(1, attempts + 1):
            try:
                with span("model.generate", **{"model.provider": self.provider.name, "model.name": model,
                                               "model.purpose": request.metadata.purpose,
                                               "task.id": request.metadata.task_id}):
                    response = await asyncio.wait_for(
                        self.provider.generate(request, model),
                        timeout=(request.timeout_seconds or self.settings.model_timeout_seconds) + 5,
                    )
            except TimeoutError as exc:
                err: ModelError = ModelTimeout()
                await self._record_failure(request, model, err)
                if attempt == attempts:
                    raise err from exc
                await asyncio.sleep(self._backoff(attempt))
                continue
            except (ModelRateLimited, ModelUnavailable, ModelTimeout) as exc:
                await self._record_failure(request, model, exc)
                if attempt == attempts or (isinstance(exc, ModelUnavailable) and not exc.details.get("retryable")):
                    raise
                retry_after = exc.details.get("retry_after") if isinstance(exc, ModelRateLimited) else None
                await asyncio.sleep(min(30.0, float(retry_after)) if retry_after else self._backoff(attempt))
                continue
            except ModelError as exc:
                await self._record_failure(request, model, exc)
                raise
            await self._record_success(request, response)
            return response
        raise ModelUnavailable()  # pragma: no cover

    @staticmethod
    def _backoff(attempt: int) -> float:
        return min(20.0, (2 ** (attempt - 1)) * 0.5) * (1 + random.random() * 0.3)  # noqa: S311

    async def _record_success(self, request: ModelRequest, response: ModelResponse) -> None:
        usage = response.usage
        in_tok = usage.input_tokens or usage.input_token_estimate
        out_tok = usage.output_tokens or usage.output_token_estimate
        usage.cost_usd, usage.priced = estimate_cost(response.model, in_tok, out_tok)
        metrics.model_latency.labels(response.provider, response.model).observe(response.latency_ms / 1000)
        metrics.model_tokens_total.labels(response.provider, response.model, "input").inc(in_tok)
        metrics.model_tokens_total.labels(response.provider, response.model, "output").inc(out_tok)
        logger.info("model_call", extra={
            "purpose": request.metadata.purpose, "model": response.model, "provider": response.provider,
            "latency_ms": round(response.latency_ms, 1), "input_tokens": in_tok, "output_tokens": out_tok,
            "status": response.status, "task_id": str(request.metadata.task_id or ""),
        })
        if self.usage_sink is not None:
            try:
                await self.usage_sink(request.metadata, response, None)
            except Exception:
                logger.exception("usage sink failed")

    async def _record_failure(self, request: ModelRequest, model: str, exc: Exception) -> None:
        metrics.model_error_total.labels(self.provider.name, model, type(exc).__name__).inc()
        logger.warning("model_call_failed", extra={"purpose": request.metadata.purpose, "model": model,
                                                   "error": type(exc).__name__})
        if self.usage_sink is not None:
            try:
                await self.usage_sink(request.metadata, None, type(exc).__name__)
            except Exception:
                logger.exception("usage sink failed")

    # ------------------------------------------------------------------ structured output
    async def generate_structured(self, request: ModelRequest, output_model: type[T], *,
                                  max_repairs: int = 2, model_policy: dict[str, Any] | None = None
                                  ) -> tuple[T, list[ModelResponse]]:
        """Strict schema → parse → validate. Invalid output triggers a bounded repair turn
        that shows the model its validation errors; after that we fail safely."""
        request = request.model_copy(update={"response_schema": output_model.model_json_schema(), "json_mode": True})
        responses: list[ModelResponse] = []
        messages = list(request.messages)
        last_error = ""
        for attempt in range(max_repairs + 1):
            response = await self.generate(request.model_copy(update={"messages": messages}),
                                           model_policy=model_policy)
            responses.append(response)
            try:
                return parse_structured(response.text, output_model), responses
            except ModelOutputInvalid as exc:
                last_error = str(exc.details.get("errors", exc.message))[:2000]
                logger.info("structured output invalid; repairing", extra={"attempt": attempt,
                                                                           "purpose": request.metadata.purpose})
                messages = [*request.messages, Message(role="model", text=response.text[:8000]), Message(
                    role="user",
                    text=("Your previous output did not validate against the required JSON schema. "
                          f"Validation errors: {last_error}\nReturn ONLY corrected JSON that satisfies the schema."),
                )]
        raise ModelOutputInvalid(details={"errors": last_error, "attempts": max_repairs + 1})

    async def embed(self, texts: list[str], *, task_type: str = "RETRIEVAL_DOCUMENT",
                    metadata: CallMetadata | None = None) -> list[list[float]]:
        if not texts:
            return []
        with span("model.embed", **{"model.provider": self.provider.name, "count": len(texts)}):
            vectors: list[list[float]] = []
            for i in range(0, len(texts), 64):
                vectors.extend(await self.provider.embed(texts[i:i + 64], task_type=task_type,
                                                         dimensions=self.settings.embedding_dimensions))
            return vectors


def parse_structured(text: str, output_model: type[T]) -> T:
    cleaned = _FENCE.sub("", text.strip())
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # Tolerate leading/trailing prose around a single JSON object, nothing more.
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end <= start:
            raise ModelOutputInvalid(details={"errors": f"not JSON: {exc.msg}"}) from exc
        try:
            data = json.loads(cleaned[start:end + 1])
        except json.JSONDecodeError as exc2:
            raise ModelOutputInvalid(details={"errors": f"not JSON: {exc2.msg}"}) from exc2
    try:
        return output_model.model_validate(data)
    except ValidationError as exc:
        errors = [{"loc": ".".join(str(p) for p in e["loc"]), "msg": e["msg"]} for e in exc.errors()[:20]]
        raise ModelOutputInvalid(details={"errors": errors}) from exc


_router: ModelRouter | None = None


def build_model_router(settings: Settings | None = None) -> ModelRouter:
    from app.model_gateway.providers.gemini import GeminiProvider
    from app.model_gateway.providers.scripted import ScriptedProvider
    from app.security.ratelimit import get_rate_limiter
    from app.usage.service import record_model_usage

    settings = settings or get_settings()
    provider: ModelProvider
    if settings.model_provider == "scripted":
        provider = ScriptedProvider(dimensions=settings.embedding_dimensions)
    else:
        provider = GeminiProvider(settings)
    return ModelRouter(provider, settings, usage_sink=record_model_usage, rate_limiter=get_rate_limiter())


def get_model_router() -> ModelRouter:
    global _router
    if _router is None:
        _router = build_model_router()
    return _router


def set_model_router(router: ModelRouter | None) -> None:
    global _router
    _router = router
