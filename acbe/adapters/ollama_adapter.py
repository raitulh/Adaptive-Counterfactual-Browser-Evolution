"""
Ollama adapter -- talks to a local (or remote) Ollama server's
``/api/chat`` endpoint. Used by ``ModelRouter``'s "small/local model" tier
and by any ``AgentAdapter`` that wants an LLM to turn a compact observation
into the next action.

Built on ``requests`` (already a transitive dependency of several packages
in this environment) rather than ``httpx``, so the core install has zero
*new* required dependencies. Swap in an httpx-based client transparently if
you prefer -- this class only needs ``chat()`` to keep its signature.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Dict, List


@dataclass
class ChatResponse:
    content: str
    input_tokens: int
    output_tokens: int
    latency_ms: float
    raw: Dict[str, Any]


class OllamaAdapter:
    def __init__(self, model: str = "qwen2.5:7b", base_url: str = "http://localhost:11434", timeout: float = 60.0):
        self.model = model
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _chat_sync(self, messages: List[Dict[str, str]], **options: Any) -> ChatResponse:
        import time
        import requests  # imported lazily so the module stays importable without it

        start = time.time()
        resp = requests.post(
            f"{self.base_url}/api/chat",
            json={"model": self.model, "messages": messages, "stream": False, "options": options},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        data = resp.json()
        latency_ms = (time.time() - start) * 1000
        content = data.get("message", {}).get("content", "")
        return ChatResponse(
            content=content,
            input_tokens=data.get("prompt_eval_count", 0),
            output_tokens=data.get("eval_count", 0),
            latency_ms=latency_ms,
            raw=data,
        )

    async def chat(self, messages: List[Dict[str, str]], **options: Any) -> ChatResponse:
        return await asyncio.to_thread(self._chat_sync, messages, **options)
