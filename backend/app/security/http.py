"""SSRF-safe outbound HTTP for untrusted destinations (web fetch, MCP, webhooks).

Connects to the IP address vetted by ``EgressPolicy`` while preserving the
original Host header and TLS SNI, follows redirects manually (re-vetting every
hop), enforces a timeout and a hard response-size cap.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx

from app.core.config import get_settings
from app.core.exceptions import IntegrationError, IntegrationTimeout, PayloadTooLarge, UnsafeURL
from app.security.ssrf import EgressPolicy, VettedURL


@dataclass(slots=True)
class SafeResponse:
    url: str
    status_code: int
    headers: dict[str, str]
    content: bytes

    @property
    def text(self) -> str:
        charset = "utf-8"
        ctype = self.headers.get("content-type", "")
        if "charset=" in ctype:
            charset = ctype.split("charset=")[-1].split(";")[0].strip() or "utf-8"
        try:
            return self.content.decode(charset, errors="replace")
        except LookupError:
            return self.content.decode("utf-8", errors="replace")


def _pin(vetted: VettedURL) -> tuple[str, dict[str, str], dict[str, Any]]:
    parts = urlsplit(vetted.url)
    ip = vetted.addresses[0]
    host_for_url = f"[{ip}]" if ":" in ip else ip
    default_port = 443 if vetted.scheme == "https" else 80
    netloc = host_for_url if vetted.port == default_port else f"{host_for_url}:{vetted.port}"
    pinned = urlunsplit((parts.scheme, netloc, parts.path or "/", parts.query, ""))
    host_header = vetted.host if vetted.port == default_port else f"{vetted.host}:{vetted.port}"
    extensions: dict[str, Any] = {"sni_hostname": vetted.host} if vetted.scheme == "https" else {}
    return pinned, {"Host": host_header}, extensions


async def safe_request(
    method: str,
    url: str,
    *,
    policy: EgressPolicy,
    headers: dict[str, str] | None = None,
    json: Any = None,
    content: bytes | None = None,
    timeout: float | None = None,
    max_bytes: int | None = None,
    max_redirects: int = 5,
    client: httpx.AsyncClient | None = None,
) -> SafeResponse:
    settings = get_settings()
    timeout = timeout or settings.outbound_http_timeout_seconds
    max_bytes = max_bytes or settings.outbound_max_response_bytes
    own_client = client is None
    client = client or httpx.AsyncClient(timeout=timeout, follow_redirects=False, trust_env=False)
    current = url
    try:
        for _ in range(max_redirects + 1):
            vetted = await policy.check_url(current)
            pinned, host_headers, extensions = _pin(vetted)
            req_headers = {"User-Agent": "AgentOS/1.0 (+safe-fetch)", **(headers or {}), **host_headers}
            request = client.build_request(method, pinned, headers=req_headers, json=json, content=content,
                                           extensions=extensions, timeout=timeout)
            try:
                response = await client.send(request, stream=True)
            except httpx.TimeoutException as exc:
                raise IntegrationTimeout("Outbound request timed out") from exc
            except httpx.HTTPError as exc:
                raise IntegrationError("Outbound request failed", details={"reason": type(exc).__name__}) from exc
            try:
                if response.status_code in (301, 302, 303, 307, 308) and "location" in response.headers:
                    current = urljoin(current, response.headers["location"])
                    if response.status_code == 303:
                        method, json, content = "GET", None, None
                    continue
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise PayloadTooLarge("Upstream response exceeds the allowed size")
                return SafeResponse(url=current, status_code=response.status_code,
                                    headers={k.lower(): v for k, v in response.headers.items()},
                                    content=bytes(body))
            finally:
                await response.aclose()
        raise UnsafeURL("Too many redirects")
    finally:
        if own_client:
            await client.aclose()
