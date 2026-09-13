"""
Google Gemini Adapter (Gemini 3.8 / 3.7 / Flash).

Lightweight, native REST integration with Google Generative AI API.
Provides:
- Asynchronous chat completion interface compatible with ACBE ChatResponse.
- Autonomous counterfactual failure diagnosis and locator synthesis.
- Automatic fallback across model tiers (gemini-3.8-flash, gemini-3.7-flash, gemini-flash-latest).
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import urllib.request
import urllib.error

from acbe.adapters.ollama_adapter import ChatResponse


def _load_env_key() -> Optional[str]:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if key:
        return key.strip()
    for candidate in [Path(".env"), Path(__file__).resolve().parents[2] / ".env"]:
        if candidate.exists():
            try:
                for line in candidate.read_text(encoding="utf-8-sig").splitlines():
                    line = line.strip().lstrip("\ufeff")
                    if line.startswith("GEMINI_API_KEY="):
                        return line.split("=", 1)[1].strip()
                    if line.startswith("GOOGLE_API_KEY="):
                        return line.split("=", 1)[1].strip()
            except Exception:
                continue
    return None


class GeminiAdapter:
    DEFAULT_MODELS = [
        "gemini-flash-latest",
        "gemini-3.7-flash",
        "gemini-3.8-flash",
    ]

    def __init__(
        self,
        api_key: Optional[str] = None,
        model: str = "gemini-flash-latest",
        timeout: float = 30.0,
    ):
        self.api_key = api_key or _load_env_key()
        self.primary_model = model
        self.timeout = timeout

    @property
    def is_available(self) -> bool:
        return bool(self.api_key)

    def _call_gemini_rest(self, model: str, payload_dict: Dict[str, Any]) -> Dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("GEMINI_API_KEY is not configured.")

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={self.api_key}"
        data = json.dumps(payload_dict).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _chat_sync(self, messages: List[Dict[str, str]], **params: Any) -> ChatResponse:
        contents = []
        for m in messages:
            role = "user" if m.get("role") in ("user", "system") else "model"
            contents.append({
                "role": role,
                "parts": [{"text": m.get("content", "")}]
            })

        payload = {"contents": contents}
        models_to_try = [self.primary_model] + [m for m in self.DEFAULT_MODELS if m != self.primary_model]

        last_err = None
        start = time.time()
        for m in models_to_try:
            try:
                data = self._call_gemini_rest(m, payload)
                latency_ms = (time.time() - start) * 1000
                cand = data.get("candidates", [{}])[0]
                text = cand.get("content", {}).get("parts", [{}])[0].get("text", "")
                usage = data.get("usageMetadata", {})
                return ChatResponse(
                    content=text,
                    input_tokens=usage.get("promptTokenCount", 0),
                    output_tokens=usage.get("candidatesTokenCount", 0),
                    latency_ms=latency_ms,
                    raw=data,
                )
            except Exception as e:
                last_err = e
                time.sleep(0.5)
                continue

        raise RuntimeError(f"Gemini API request failed on all candidate models: {last_err}")

    async def chat(self, messages: List[Dict[str, str]], **params: Any) -> ChatResponse:
        return await asyncio.to_thread(self._chat_sync, messages, **params)

    def diagnose_failure(
        self,
        failure_type: str,
        task_desc: str,
        target: str,
        error_detail: str,
        visible_elements: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Uses Gemini to perform counterfactual root cause analysis and recommend
        an alternate locator strategy.
        """
        prompt = f"""You are the ACBE (Adaptive Counterfactual Browser Evolution) diagnostic reasoning engine.
A browser automation agent failed on an interaction step.

FAILURE DETAILS:
- Failure Taxonomy: {failure_type}
- Task Objective: {task_desc}
- Intended Target: {target}
- Error Information: {error_detail}
- Visible Page Elements: {json.dumps(visible_elements or [])}

INSTRUCTIONS:
1. Explain the technical root cause of why the baseline locator failed (e.g. visual look-alike ambiguity, DOM sequence trap, state timing).
2. Propose a concrete, counterfactual remediation strategy choosing the most reliable locator among:
   ['dom_role', 'role_name', 'verify_before_click', 'semantic_search', 'nearby_element'].
3. Provide a concrete DOM locator selector pattern.
4. Provide the engineering reasoning for why this counterfactual change avoids regression.

Respond with ONLY a valid JSON object matching this schema:
{{
  "failure_type": "{failure_type}",
  "root_cause": "clear explanation of root cause",
  "recommended_locator": "dom_role | role_name | verify_before_click | semantic_search | nearby_element",
  "selector_patch": "concrete selector or pattern",
  "reasoning": "technical explanation of why this prevents regression"
}}
"""
        try:
            resp = self._chat_sync([{"role": "user", "content": prompt}])
            text = resp.content.strip()

            if "```json" in text:
                text = text.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in text:
                text = text.split("```", 1)[1].split("```", 1)[0].strip()

            parsed = json.loads(text)
            parsed["latency_ms"] = round(resp.latency_ms, 1)
            parsed["tokens"] = resp.input_tokens + resp.output_tokens
            parsed["model"] = self.primary_model
            parsed["live_gemini"] = True
            return parsed
        except Exception as exc:
            # Domain-informed deterministic fallback when API is temporarily unavailable
            return {
                "failure_type": failure_type,
                "root_cause": f"Diagnosed by ACBE Engine: {error_detail}",
                "recommended_locator": "dom_role",
                "selector_patch": f"role=button[name*='{target}']",
                "reasoning": f"Counterfactual rule: disambiguate target using accessible DOM role rather than visual text heuristic.",
                "latency_ms": 12.0,
                "tokens": 120,
                "model": "rule-engine-fallback",
                "live_gemini": False,
                "notice": str(exc),
            }
