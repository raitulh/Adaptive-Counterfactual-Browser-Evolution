from __future__ import annotations

from typing import Protocol

from app.model_gateway.types import ModelRequest, ModelResponse


class ModelProvider(Protocol):
    name: str

    async def generate(self, request: ModelRequest, model: str) -> ModelResponse: ...

    async def embed(self, texts: list[str], *, task_type: str, model: str | None = None,
                    dimensions: int | None = None) -> list[list[float]]: ...

    def is_configured(self) -> bool: ...
