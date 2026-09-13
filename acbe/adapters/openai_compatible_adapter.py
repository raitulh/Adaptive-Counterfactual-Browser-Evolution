"""
Generic OpenAI-compatible chat-completions adapter. Works against OpenAI
itself, and against any provider that speaks the same
``/v1/chat/completions`` shape (many local/hosted "OpenAI-compatible"
servers, including some Ollama and vLLM configurations, and, per Section 2,
Qwen-hosted endpoints).
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

from acbe.adapters.ollama_adapter import ChatResponse


class OpenAICompatibleAdapter:
    def __init__(self, model: str, base_url: str = "https://api.openai.com/v1",
                 api_key: Optional[str] = None, timeout: float = 60.0):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _chat_sync(self, messages: List[Dict[str, str]], **params: Any) -> ChatResponse:
        import time
        import requests

        start = time.time()
        resp = requests.post(
            f"{self.base_url}/chat/completions",
            headers=self._headers(),
            json={"model": self.model, "messages": messages, **params},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        latency_ms = (time.time() - start) * 1000
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {})
        return ChatResponse(
            content=content,
            input_tokens=usage.get("prompt_tokens", 0),
            output_tokens=usage.get("completion_tokens", 0),
            latency_ms=latency_ms,
            raw=data,
        )

    async def chat(self, messages: List[Dict[str, str]], **params: Any) -> ChatResponse:
        return await asyncio.to_thread(self._chat_sync, messages, **params)
