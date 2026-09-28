"""Browser egress policy and enforcement.

Two layers enforce the same per-task decision cache (``EgressGuard``):

* ``context.route("**/*")`` in the executor sees the first hop of every request made by
  pages in the context: it aborts non-http(s) schemes (``file:``, ``chrome:`` …), checks
  http(s) URLs against the policy and records what it blocked.
* ``EgressProxy`` is an authenticated, per-task HTTP proxy the browser context is forced
  through (loopback included). Chromium follows redirects, preconnects and opens
  WebSockets without consulting request interception, but every one of those goes through
  the proxy, which re-checks the destination and connects only to the IP addresses the
  policy vetted — closing the DNS-rebinding window between check and connect.

The effective policy is the deployment settings plus the organization's lists, and it
always blocks private/reserved address space unless ``ALLOW_PRIVATE_NETWORK_EGRESS`` (a
development-only override refused in staging/production) is set.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import hmac
import ipaddress
import logging
import re
import secrets
from collections.abc import Iterable
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

from app.browser.schemas import MAX_BLOCKED_RECORDS, BlockedRequest
from app.common.sanitize import clean_text
from app.core.config import Settings
from app.core.exceptions import UnsafeURL
from app.security.ssrf import EgressPolicy, VettedURL

logger = logging.getLogger(__name__)

NETWORK_SCHEMES = frozenset({"http", "https"})
# In-memory sub-resources that never touch the network.
LOCAL_SUBRESOURCE_SCHEMES = frozenset({"data", "blob"})
EGRESS_MARKER_HEADER = "x-agentos-egress"


def host_matches(host: str, patterns: Iterable[str]) -> bool:
    """``example.com`` matches itself and subdomains; ``*.example.com`` matches subdomains."""
    host = host.lower().rstrip(".")
    for pattern in patterns:
        p = pattern.lower().strip().rstrip(".")
        if not p:
            continue
        if p.startswith("*."):
            if host.endswith(p[1:]) or host == p[2:]:
                return True
        elif host == p or host.endswith("." + p):
            return True
    return False


def sanitize_url(url: str, *, keep_query: bool = False, max_chars: int = 300) -> str:
    """Log-safe URL: no credentials, no fragment and (by default) no query string."""
    try:
        parts = urlsplit(url)
    except ValueError:
        return clean_text(url, max_chars=max_chars)
    if not parts.scheme:
        return clean_text(url, max_chars=max_chars)
    netloc = parts.hostname or ""
    if ":" in netloc:
        netloc = f"[{netloc}]"
    try:
        if parts.port is not None:
            netloc = f"{netloc}:{parts.port}"
    except ValueError:
        pass
    if parts.scheme in LOCAL_SUBRESOURCE_SCHEMES:
        return f"{parts.scheme}:…"
    cleaned = urlunsplit((parts.scheme, netloc, parts.path, parts.query if keep_query else "", ""))
    return clean_text(cleaned, max_chars=max_chars)


@dataclass(slots=True)
class BrowserEgressPolicy:
    """``egress`` carries the deployment allowlist, all denylists and the private-network
    rule; ``extra_allowlists`` are further allowlists a host must *also* satisfy (an
    organization cannot widen the deployment allowlist, only narrow it)."""

    egress: EgressPolicy
    extra_allowlists: tuple[tuple[str, ...], ...] = ()

    @property
    def allow_private_network(self) -> bool:
        return self.egress.allow_private_network

    def check_syntax(self, url: str) -> tuple[str, str, int]:
        scheme, host, port = self.egress.check_syntax(url)
        for allowlist in self.extra_allowlists:
            if allowlist and not host_matches(host, allowlist):
                raise UnsafeURL("Domain is not in the organization's browser allowlist", details={"host": host})
        return scheme, host, port

    def allows_syntax(self, url: str) -> bool:
        try:
            self.check_syntax(url)
        except UnsafeURL:
            return False
        return True

    async def check_url(self, url: str) -> VettedURL:
        self.check_syntax(url)
        return await self.egress.check_url(url)


def build_browser_policy(settings: Settings, *, org_allowed: Iterable[str] = (), org_denied: Iterable[str] = ()
                         ) -> BrowserEgressPolicy:
    """Effective policy = deployment settings ∩ organization allowlist, ∪ both denylists,
    hard private/reserved-address block (dev override only)."""
    deployment_allowed = [d for d in settings.browser_allowed_domains if d.strip()]
    org_allowed_list = [d for d in org_allowed if d.strip()]
    denied = [d for d in [*settings.browser_denied_domains, *org_denied] if d.strip()]
    extra: tuple[tuple[str, ...], ...] = ()
    if deployment_allowed and org_allowed_list:
        allowed, extra = deployment_allowed, (tuple(org_allowed_list),)
    else:
        allowed = deployment_allowed or org_allowed_list
    return BrowserEgressPolicy(
        egress=EgressPolicy(allowed_domains=allowed, denied_domains=denied,
                            allow_private_network=settings.allow_private_network_egress),
        extra_allowlists=extra,
    )


# ----------------------------------------------------------------------------- guard
@dataclass(slots=True)
class _Denied:
    message: str
    details: dict[str, object]


class EgressGuard:
    """Per-task policy decisions with DNS results cached per (scheme, host, port), plus the
    bounded record of what was blocked. Shared by the route handler and the proxy."""

    def __init__(self, policy: BrowserEgressPolicy, *, max_records: int = MAX_BLOCKED_RECORDS) -> None:
        self.policy = policy
        self.max_records = max_records
        self.blocked: list[BlockedRequest] = []
        self.blocked_total = 0
        self.lookups = 0
        self._decisions: dict[tuple[str, str, int], asyncio.Future[VettedURL | _Denied]] = {}

    async def vet(self, url: str) -> VettedURL:
        scheme, host, port = self.policy.check_syntax(url)
        key = (scheme, host, port)
        future = self._decisions.get(key)
        if future is None:
            future = asyncio.get_running_loop().create_future()
            self._decisions[key] = future
            self.lookups += 1
            try:
                outcome: VettedURL | _Denied = await self.policy.egress.check_url(url)
            except UnsafeURL as exc:
                outcome = _Denied(exc.message, dict(exc.details))
            except asyncio.CancelledError:
                self._decisions.pop(key, None)
                future.set_result(_Denied("Host lookup was interrupted", {"host": host}))
                raise
            except Exception:
                logger.warning("egress check failed", extra={"host": host})
                outcome = _Denied("Host could not be vetted", {"host": host})
            future.set_result(outcome)
        decision = await asyncio.shield(future)
        if isinstance(decision, _Denied):
            raise UnsafeURL(decision.message, details=dict(decision.details))
        return VettedURL(url=url, scheme=scheme, host=host, port=port, addresses=decision.addresses)

    async def is_allowed(self, url: str) -> bool:
        try:
            await self.vet(url)
        except UnsafeURL:
            return False
        return True

    def record(self, url: str, reason: str, *, resource_type: str | None = None, source: str = "route") -> None:
        self.blocked_total += 1
        if len(self.blocked) >= self.max_records:
            return
        self.blocked.append(BlockedRequest(url=sanitize_url(url), reason=clean_text(reason, max_chars=200),
                                           resource_type=resource_type, source=source))  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- proxy
_METHOD = re.compile(r"^[A-Z]{3,12}$")
_REQUEST_HOP_BY_HOP = frozenset({"connection", "keep-alive", "proxy-connection", "proxy-authorization",
                                 "proxy-authenticate", "te", "trailer", "upgrade"})
_RESPONSE_HOP_BY_HOP = frozenset({"connection", "keep-alive", "proxy-connection"})


class _Limit(Exception):
    pass


@dataclass(slots=True)
class ProxyLimits:
    max_bytes: int = 64 * 1024 * 1024
    max_requests: int = 2_000
    max_connections: int = 64
    max_request_body: int = 10 * 1024 * 1024
    max_head_bytes: int = 64 * 1024
    idle_timeout: float = 30.0
    connect_timeout: float = 10.0


@dataclass
class EgressProxy:
    """Authenticated forward proxy bound to 127.0.0.1 for one browser context.

    CONNECT tunnels (https/wss) and absolute-form plain-HTTP requests are allowed only
    to destinations the guard approves, and are connected to the *vetted* IP address.
    Every plain-HTTP exchange is a single request (``Connection: close``) so one proxy
    connection can never be reused to reach a different host.
    """

    guard: EgressGuard
    limits: ProxyLimits = field(default_factory=ProxyLimits)
    username: str = field(default_factory=lambda: "u" + secrets.token_hex(8))
    password: str = field(default_factory=lambda: secrets.token_urlsafe(24))
    bytes_relayed: int = 0
    requests: int = 0
    budget_exceeded: bool = False
    _server: asyncio.AbstractServer | None = None
    _tasks: set[asyncio.Task[None]] = field(default_factory=set)
    _port: int = 0

    async def start(self) -> None:
        self._server = await asyncio.start_server(self._handle, host="127.0.0.1", port=0,
                                                  limit=self.limits.max_head_bytes)
        self._port = self._server.sockets[0].getsockname()[1]

    @property
    def server_url(self) -> str:
        return f"http://127.0.0.1:{self._port}"

    def playwright_config(self) -> dict[str, str]:
        # "<-loopback>" removes Chromium's implicit proxy bypass for localhost/127.0.0.1.
        return {"server": self.server_url, "bypass": "<-loopback>", "username": self.username,
                "password": self.password}

    async def close(self) -> None:
        if self._server is not None:
            self._server.close()
        for task in list(self._tasks):
            task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
        if self._server is not None:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(self._server.wait_closed(), timeout=2)
            self._server = None

    # ------------------------------------------------------------------ connection handling
    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        task = asyncio.current_task()
        if task is not None:
            self._tasks.add(task)
        try:
            if len(self._tasks) > self.limits.max_connections:
                await self._respond(writer, 503, "Too many connections")
                return
            head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=self.limits.idle_timeout)
            request_line, headers = _parse_head(head)
            parts = request_line.split(" ")
            if len(parts) != 3 or not _METHOD.match(parts[0]) or not parts[2].startswith("HTTP/1."):
                await self._respond(writer, 400, "Bad request")
                return
            if not self._authorized(headers):
                await self._respond(writer, 407, "Proxy authentication required",
                                    extra=[("Proxy-Authenticate", 'Basic realm="agentos-browser"')])
                return
            self.requests += 1
            if self.requests > self.limits.max_requests:
                self.guard.record(parts[1], "request limit reached", source="proxy")
                await self._respond(writer, 403, "Request limit reached", blocked=True)
                return
            if parts[0] == "CONNECT":
                await self._tunnel(parts[1], reader, writer)
            else:
                await self._forward(parts[0], parts[1], headers, reader, writer)
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError, ConnectionError, OSError,
                ValueError, _Limit):
            pass
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("egress proxy connection failed", exc_info=True)
        finally:
            with contextlib.suppress(Exception):
                writer.close()
            if task is not None:
                self._tasks.discard(task)

    def _authorized(self, headers: list[tuple[str, str]]) -> bool:
        expected = "Basic " + base64.b64encode(f"{self.username}:{self.password}".encode()).decode()
        for name, value in headers:
            if name.lower() == "proxy-authorization":
                return hmac.compare_digest(value.strip().encode(), expected.encode())
        return False

    async def _tunnel(self, authority: str, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        host, port = _split_authority(authority)
        if host is None or port is None:
            await self._respond(writer, 400, "Bad CONNECT target")
            return
        scheme = "http" if port == 80 else "https"
        url = f"{scheme}://{_bracket(host)}:{port}/"
        try:
            vetted = await self.guard.vet(url)
        except UnsafeURL as exc:
            self.guard.record(url, exc.message, source="proxy")
            await self._respond(writer, 403, "Blocked by egress policy", blocked=True)
            return
        upstream = await self._open_upstream(vetted)
        if upstream is None:
            await self._respond(writer, 502, "Upstream connection failed")
            return
        up_reader, up_writer = upstream
        try:
            writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            await writer.drain()
            await self._splice(reader, writer, up_reader, up_writer)
        finally:
            with contextlib.suppress(Exception):
                up_writer.close()

    async def _forward(self, method: str, target: str, headers: list[tuple[str, str]],
                       reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        parts = urlsplit(target)
        if parts.scheme.lower() != "http" or not parts.hostname:
            await self._respond(writer, 400, "Absolute http URL required")
            return
        try:
            vetted = await self.guard.vet(target)
        except UnsafeURL as exc:
            self.guard.record(target, exc.message, source="proxy")
            await self._respond(writer, 403, "Blocked by egress policy", blocked=True)
            return
        length = 0
        connection_tokens: set[str] = set()
        for name, value in headers:
            lname = name.lower()
            if lname == "transfer-encoding":
                await self._respond(writer, 501, "Chunked request bodies are not supported")
                return
            if lname == "content-length":
                try:
                    length = int(value.strip())
                except ValueError:
                    await self._respond(writer, 400, "Invalid Content-Length")
                    return
            if lname == "connection":
                connection_tokens |= {t.strip().lower() for t in value.split(",") if t.strip()}
        if length < 0 or length > self.limits.max_request_body:
            await self._respond(writer, 413, "Request body too large")
            return
        upstream = await self._open_upstream(vetted)
        if upstream is None:
            await self._respond(writer, 502, "Upstream connection failed")
            return
        up_reader, up_writer = upstream
        try:
            path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
            lines = [f"{method} {path} HTTP/1.1"]
            has_host = False
            for name, value in headers:
                lname = name.lower()
                if lname in _REQUEST_HOP_BY_HOP or lname in connection_tokens:
                    continue
                has_host = has_host or lname == "host"
                lines.append(f"{name}: {value}")
            if not has_host:
                lines.append(f"Host: {parts.netloc.rsplit('@', 1)[-1]}")
            lines.append("Connection: close")
            up_writer.write(("\r\n".join(lines) + "\r\n\r\n").encode("latin-1"))
            if length:
                body = await asyncio.wait_for(reader.readexactly(length), timeout=self.limits.idle_timeout)
                self._count(len(body))
                up_writer.write(body)
            await up_writer.drain()
            response_head = await asyncio.wait_for(up_reader.readuntil(b"\r\n\r\n"), timeout=self.limits.idle_timeout)
            status_line, response_headers = _parse_head(response_head)
            kept = [f"{n}: {v}" for n, v in response_headers if n.lower() not in _RESPONSE_HOP_BY_HOP]
            new_head = "\r\n".join([status_line, *kept, "Connection: close"]) + "\r\n\r\n"
            self._count(len(response_head))
            writer.write(new_head.encode("latin-1"))
            await writer.drain()
            await self._pump(up_reader, writer)
        finally:
            with contextlib.suppress(Exception):
                up_writer.close()

    async def _open_upstream(self, vetted: VettedURL) -> tuple[asyncio.StreamReader, asyncio.StreamWriter] | None:
        for address in vetted.addresses:
            try:
                ipaddress.ip_address(address)
                return await asyncio.wait_for(
                    asyncio.open_connection(address, vetted.port, limit=self.limits.max_head_bytes),
                    timeout=self.limits.connect_timeout)
            except (OSError, TimeoutError, ValueError):
                continue
        return None

    async def _splice(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                      up_reader: asyncio.StreamReader, up_writer: asyncio.StreamWriter) -> None:
        tasks = {asyncio.create_task(self._pump(reader, up_writer)), asyncio.create_task(self._pump(up_reader, writer))}
        try:
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _pump(self, src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
        with contextlib.suppress(ConnectionError, OSError, TimeoutError, asyncio.IncompleteReadError):
            while True:
                data = await asyncio.wait_for(src.read(65536), timeout=self.limits.idle_timeout)
                if not data:
                    break
                self._count(len(data))
                dst.write(data)
                await dst.drain()

    def _count(self, n: int) -> None:
        self.bytes_relayed += n
        if self.bytes_relayed > self.limits.max_bytes:
            if not self.budget_exceeded:
                self.budget_exceeded = True
                self.guard.record("proxy://budget", "network transfer budget exceeded", source="proxy")
            raise _Limit()

    async def _respond(self, writer: asyncio.StreamWriter, status: int, reason: str, *, blocked: bool = False,
                       extra: list[tuple[str, str]] | None = None) -> None:
        body = reason.encode()
        headers = [f"HTTP/1.1 {status} {reason}", "Content-Type: text/plain; charset=utf-8",
                   f"Content-Length: {len(body)}", "Connection: close", "Cache-Control: no-store"]
        if blocked:
            headers.append(f"{EGRESS_MARKER_HEADER}: blocked")
        headers.extend(f"{n}: {v}" for n, v in (extra or []))
        with contextlib.suppress(ConnectionError, OSError):
            writer.write(("\r\n".join(headers) + "\r\n\r\n").encode("latin-1") + body)
            await writer.drain()


def _parse_head(head: bytes) -> tuple[str, list[tuple[str, str]]]:
    lines = head.decode("latin-1").split("\r\n")
    headers: list[tuple[str, str]] = []
    for line in lines[1:]:
        if not line:
            continue
        name, sep, value = line.partition(":")
        if not sep or not name or name != name.strip():
            raise ValueError("malformed header")
        headers.append((name, value.strip()))
    return lines[0], headers


def _split_authority(authority: str) -> tuple[str | None, int | None]:
    if authority.startswith("["):
        host, _, rest = authority[1:].partition("]")
        port_text = rest[1:] if rest.startswith(":") else ""
    else:
        host, _, port_text = authority.rpartition(":")
    if not host or not port_text.isdigit():
        return None, None
    port = int(port_text)
    if not 0 < port < 65536:
        return None, None
    return host.lower(), port


def _bracket(host: str) -> str:
    return f"[{host}]" if ":" in host else host
