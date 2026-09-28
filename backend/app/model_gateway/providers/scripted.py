"""Deterministic scripted provider for automated tests and offline evaluation harnesses.

It is *refused* in staging/production by ``Settings.validate_for_startup``. It never
pretends to be a real model: every response comes from an explicit handler supplied
by the test or evaluation fixture.
"""

from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Callable
from typing import Any

from app.core.exceptions import ModelUnavailable
from app.model_gateway.types import ModelRequest, ModelResponse, ModelUsage, estimate_tokens

Handler = Callable[[ModelRequest], str | Exception]


class ScriptedProvider:
    name = "scripted"

    def __init__(self, handler: Handler | None = None, *, dimensions: int = 768) -> None:
        self.handler = handler
        self.dimensions = dimensions
        self.calls: list[ModelRequest] = []

    def is_configured(self) -> bool:
        return self.handler is not None

    async def generate(self, request: ModelRequest, model: str) -> ModelResponse:
        self.calls.append(request)
        if self.handler is None:
            raise ModelUnavailable("No scripted model handler installed")
        out = self.handler(request)
        if isinstance(out, Exception):
            raise out
        return ModelResponse(
            text=out, model=model, provider=self.name, finish_reason="STOP",
            usage=ModelUsage(input_tokens=estimate_tokens(request.system + "".join(m.text for m in request.messages)),
                             output_tokens=estimate_tokens(out)),
        )

    async def embed(self, texts: list[str], *, task_type: str, model: str | None = None,
                    dimensions: int | None = None) -> list[list[float]]:
        return [hashed_embedding(t, dimensions or self.dimensions) for t in texts]


def hashed_embedding(text: str, dims: int) -> list[float]:
    """Feature-hashing bag-of-words vector: deterministic and similarity-preserving enough
    for tests of the retrieval pipeline (not a semantic model)."""
    vec = [0.0] * dims
    for token in re.findall(r"[a-z0-9]+", text.lower()):
        h = int(hashlib.md5(token.encode(), usedforsecurity=False).hexdigest(), 16)
        vec[h % dims] += 1.0 if (h >> 8) & 1 else -1.0
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def json_handler(responses: dict[str, Any]) -> Handler:
    """Route by ``metadata.purpose`` to canned JSON strings (or callables)."""
    import json

    def _handle(request: ModelRequest) -> str | Exception:
        value = responses.get(request.metadata.purpose)
        if value is None:
            return ModelUnavailable(f"no scripted response for purpose {request.metadata.purpose}")
        if callable(value):
            value = value(request)
        if isinstance(value, Exception):
            return value
        return value if isinstance(value, str) else json.dumps(value)

    return _handle
