from __future__ import annotations

import asyncio
import base64
from typing import Any

import pytest
from browser_testkit import LocalSite, install_resolver, local_policy, trusted_host_policy

from app.browser.policy import (
    EGRESS_MARKER_HEADER,
    BrowserEgressPolicy,
    EgressGuard,
    EgressProxy,
    ProxyLimits,
    build_browser_policy,
    host_matches,
    sanitize_url,
)
from app.core.config import Settings
from app.core.exceptions import UnsafeURL
from app.security.ssrf import EgressPolicy


def _settings(**kw: Any) -> Settings:
    return Settings(**kw)


# ---------------------------------------------------------------------------- effective policy
def test_effective_policy_merges_settings_and_org_lists() -> None:
    policy = build_browser_policy(_settings(browser_allowed_domains=["example.com", "example.org"],
                                            browser_denied_domains=["bad.example.com"]),
                                  org_allowed=["example.com"], org_denied=["evil.example.com"])
    assert policy.allows_syntax("https://www.example.com/")
    assert not policy.allows_syntax("https://example.org/")  # outside the org allowlist
    assert not policy.allows_syntax("https://example.net/")  # outside the deployment allowlist
    assert not policy.allows_syntax("https://bad.example.com/")
    assert not policy.allows_syntax("https://evil.example.com/")
    assert not policy.allow_private_network


def test_org_allowlist_applies_when_deployment_has_none() -> None:
    policy = build_browser_policy(_settings(), org_allowed=["docs.example.com"])
    assert policy.allows_syntax("https://docs.example.com/x")
    assert not policy.allows_syntax("https://example.com/")
    open_policy = build_browser_policy(_settings())
    assert open_policy.allows_syntax("https://anything.example/")


def test_private_network_override_is_the_only_way_to_reach_private_space() -> None:
    assert not build_browser_policy(_settings()).allow_private_network
    assert build_browser_policy(_settings(allow_private_network_egress=True)).allow_private_network


def test_host_matching_and_url_sanitizing() -> None:
    assert host_matches("a.example.com", ["example.com"])
    assert host_matches("example.com", ["*.example.com"])
    assert not host_matches("badexample.com", ["example.com"])
    assert sanitize_url("https://u:p@example.com:8443/p/a?token=secret#frag") == "https://example.com:8443/p/a"
    assert sanitize_url("https://example.com/p?q=1", keep_query=True) == "https://example.com/p?q=1"
    assert sanitize_url("data:text/html,<script>") == "data:…"


# ---------------------------------------------------------------------------- guard
@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "http://localhost:8080/", "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/", "http://192.168.1.1/", "http://[::1]/", "http://metadata.google.internal/",
    "file:///etc/passwd", "ftp://example.com/", "http://example.com:22/",
])
async def test_default_policy_blocks_local_and_reserved_destinations(url: str) -> None:
    guard = EgressGuard(build_browser_policy(_settings()))
    with pytest.raises(UnsafeURL):
        await guard.vet(url)


async def test_hostnames_resolving_to_private_space_are_blocked(monkeypatch: pytest.MonkeyPatch) -> None:
    install_resolver(monkeypatch, {"public.example": "93.184.215.14", "rebind.example": "10.0.0.7",
                                   "meta.example": "169.254.169.254"})
    guard = EgressGuard(build_browser_policy(_settings()))
    vetted = await guard.vet("https://public.example/page")
    assert vetted.addresses == ("93.184.215.14",)
    for host in ("rebind.example", "meta.example"):
        with pytest.raises(UnsafeURL, match="private or reserved"):
            await guard.vet(f"https://{host}/")


async def test_dns_decisions_are_cached_per_task(monkeypatch: pytest.MonkeyPatch) -> None:
    lookups = install_resolver(monkeypatch, {"public.example": "93.184.215.14", "rebind.example": "10.0.0.7"})
    guard = EgressGuard(build_browser_policy(_settings()))
    await asyncio.gather(*(guard.vet(f"https://public.example/{i}") for i in range(5)))
    for _ in range(3):
        with pytest.raises(UnsafeURL):
            await guard.vet("https://rebind.example/x")
    assert lookups.count("public.example") == 1
    assert lookups.count("rebind.example") == 1
    assert guard.lookups == 2
    # A new task gets a fresh cache.
    await EgressGuard(build_browser_policy(_settings())).vet("https://public.example/")
    assert lookups.count("public.example") == 2


async def test_guard_records_are_bounded_and_sanitized() -> None:
    guard = EgressGuard(build_browser_policy(_settings()), max_records=3)
    for i in range(10):
        guard.record(f"http://10.0.0.{i}/p?secret=1", "blocked")
    assert guard.blocked_total == 10
    assert len(guard.blocked) == 3
    assert all("secret" not in r.url for r in guard.blocked)


# ---------------------------------------------------------------------------- proxy
async def _raw(proxy: EgressProxy, data: bytes, *, auth: bool = True, read_body: bool = True) -> bytes:
    reader, writer = await asyncio.open_connection("127.0.0.1", int(proxy.server_url.rsplit(":", 1)[1]))
    if auth:
        token = base64.b64encode(f"{proxy.username}:{proxy.password}".encode()).decode()
        head, sep, rest = data.partition(b"\r\n")
        data = head + sep + f"Proxy-Authorization: Basic {token}\r\n".encode() + rest
    writer.write(data)
    await writer.drain()
    out = await asyncio.wait_for(reader.read(-1) if read_body else reader.readuntil(b"\r\n\r\n"), timeout=10)
    writer.close()
    return out


@pytest.fixture
async def proxy_for(site: LocalSite) -> Any:
    proxies: list[EgressProxy] = []

    async def _make(policy: BrowserEgressPolicy, **limits: Any) -> EgressProxy:
        proxy = EgressProxy(EgressGuard(policy), limits=ProxyLimits(**limits))
        await proxy.start()
        proxies.append(proxy)
        return proxy

    yield _make
    for p in proxies:
        await p.close()


async def test_proxy_requires_its_credentials(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site))
    out = await _raw(proxy, f"GET {site.base}/api-ok HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode(), auth=False)
    assert out.startswith(b"HTTP/1.1 407")
    token = base64.b64encode(b"wrong:creds").decode()
    out = await _raw(proxy, (f"GET {site.base}/api-ok HTTP/1.1\r\nProxy-Authorization: Basic {token}\r\n"
                             "Host: 127.0.0.1\r\n\r\n").encode(), auth=False)
    assert out.startswith(b"HTTP/1.1 407")
    assert proxy.playwright_config()["bypass"] == "<-loopback>"


async def test_proxy_relays_allowed_plain_http_as_single_request(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site))
    out = await _raw(proxy, (f"GET {site.base}/api-ok HTTP/1.1\r\nHost: 127.0.0.1:{site.port}\r\n"
                             "Connection: keep-alive\r\n\r\n").encode())
    head, _, body = out.partition(b"\r\n\r\n")
    assert head.startswith(b"HTTP/1.0 200") or head.startswith(b"HTTP/1.1 200")
    assert b"Connection: close" in head
    assert body == b"ok"


async def test_proxy_blocks_private_destinations_and_marks_the_response(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(trusted_host_policy(site))
    out = await _raw(proxy, f"GET {site.canary}/x HTTP/1.1\r\nHost: 127.0.0.2\r\n\r\n".encode())
    assert out.startswith(b"HTTP/1.1 403")
    assert f"{EGRESS_MARKER_HEADER}: blocked".encode() in out
    out = await _raw(proxy, b"GET http://169.254.169.254/latest/meta-data/ HTTP/1.1\r\nHost: x\r\n\r\n")
    assert out.startswith(b"HTTP/1.1 403")
    out = await _raw(proxy, b"CONNECT 10.0.0.1:443 HTTP/1.1\r\nHost: 10.0.0.1:443\r\n\r\n")
    assert out.startswith(b"HTTP/1.1 403")
    assert site.canary_hits == []
    reasons = {r.url: r.reason for r in proxy.guard.blocked}
    assert any("127.0.0.2" in u for u in reasons)
    assert any("169.254.169.254" in u for u in reasons)
    assert any("10.0.0.1" in u for u in reasons)
    assert all(r.source == "proxy" for r in proxy.guard.blocked)


async def test_proxy_tunnels_only_to_vetted_destinations(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site))
    reader, writer = await asyncio.open_connection("127.0.0.1", int(proxy.server_url.rsplit(":", 1)[1]))
    token = base64.b64encode(f"{proxy.username}:{proxy.password}".encode()).decode()
    writer.write((f"CONNECT 127.0.0.1:{site.port} HTTP/1.1\r\nProxy-Authorization: Basic {token}\r\n\r\n").encode())
    await writer.drain()
    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=5)
    assert head.startswith(b"HTTP/1.1 200")
    writer.write(b"GET /api-ok HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n")
    await writer.drain()
    body = await asyncio.wait_for(reader.read(-1), timeout=5)
    assert body.endswith(b"ok")
    writer.close()
    # Port 22 is never allowed.
    out = await _raw(proxy, b"CONNECT 127.0.0.1:22 HTTP/1.1\r\n\r\n")
    assert out.startswith(b"HTTP/1.1 403")


async def test_proxy_pins_the_host_header_to_the_vetted_destination(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site))
    out = await _raw(proxy, f"GET {site.base}/echo-host HTTP/1.1\r\nHost: metadata.google.internal\r\n\r\n".encode())
    assert out.endswith(f"127.0.0.1:{site.port}".encode())


async def test_proxy_rejects_malformed_and_chunked_requests(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site))
    assert (await _raw(proxy, b"BROKEN\r\n\r\n")).startswith(b"HTTP/1.1 400")
    smuggled = f"GET {site.base}/api-ok HTTP/1.1\r\nX-A: 1\nHost: evil\r\n\r\n".encode()
    assert (await _raw(proxy, smuggled)).startswith(b"HTTP/1.1 400")
    out = await _raw(proxy, (f"POST {site.base}/save HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n"
                             "0\r\n\r\n").encode())
    assert out.startswith(b"HTTP/1.1 501")
    out = await _raw(proxy, f"GET https://127.0.0.1:{site.port}/ HTTP/1.1\r\nHost: x\r\n\r\n".encode())
    assert out.startswith(b"HTTP/1.1 400")


async def test_proxy_enforces_transfer_budget(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site), max_bytes=2_000)
    out = await _raw(proxy, f"GET {site.base}/big HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode())
    assert len(out) < 50_000
    assert proxy.budget_exceeded
    assert any("budget" in r.reason for r in proxy.guard.blocked)


async def test_proxy_request_limit(proxy_for: Any, site: LocalSite) -> None:
    proxy = await proxy_for(local_policy(site), max_requests=1)
    first = await _raw(proxy, f"GET {site.base}/api-ok HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode())
    second = await _raw(proxy, f"GET {site.base}/api-ok HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n".encode())
    assert b" 200 " in first.split(b"\r\n", 1)[0]
    assert second.startswith(b"HTTP/1.1 403")


async def test_private_egress_policy_object_for_dev_tests() -> None:
    policy = BrowserEgressPolicy(EgressPolicy(allow_private_network=True, allowed_ports={80}))
    guard = EgressGuard(policy)
    assert (await guard.vet("http://127.0.0.1/")).addresses == ("127.0.0.1",)
