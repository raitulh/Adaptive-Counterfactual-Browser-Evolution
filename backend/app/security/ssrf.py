"""SSRF / egress policy.

Every outbound URL chosen (directly or indirectly) by a model, a user, a web
page or an MCP server passes through ``EgressPolicy.check_url``:

* only http/https, no credentials in the URL, sane ports;
* host allow/deny lists (per deployment and per tenant);
* the hostname is resolved and **every** resolved address must be public
  (no loopback, RFC1918, link-local/metadata, CGNAT, ULA, multicast, reserved).

``SafeTransport`` (see ``app.security.http``) connects to the *vetted IP*
(with the original Host header and TLS SNI), closing the DNS-rebinding
window between check and connect.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from app.core.exceptions import UnsafeURL

_BLOCKED_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
        "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15",
        "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
        "::/128", "::1/128", "::ffff:0:0/96", "64:ff9b::/96", "100::/64", "2001:db8::/32", "fc00::/7",
        "fe80::/10", "ff00::/8",
    )
]
_ALLOWED_PORTS = {80, 443, 8080, 8443}
_METADATA_HOSTS = {"metadata.google.internal", "metadata", "instance-data", "metadata.azure.com"}


def ip_is_public(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return not any(ip in net for net in _BLOCKED_NETWORKS) and ip.is_global


def _host_matches(host: str, patterns: list[str]) -> bool:
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


@dataclass(frozen=True, slots=True)
class VettedURL:
    url: str
    scheme: str
    host: str
    port: int
    addresses: tuple[str, ...]


@dataclass(slots=True)
class EgressPolicy:
    allowed_domains: list[str] = field(default_factory=list)
    denied_domains: list[str] = field(default_factory=list)
    allow_private_network: bool = False
    allowed_ports: set[int] = field(default_factory=lambda: set(_ALLOWED_PORTS))
    # Hosts explicitly trusted even if private (admin-registered internal MCP servers, dev).
    trusted_private_hosts: list[str] = field(default_factory=list)

    def check_syntax(self, url: str) -> tuple[str, str, int]:
        if len(url) > 4096:
            raise UnsafeURL("URL is too long")
        parts = urlsplit(url.strip())
        scheme = (parts.scheme or "").lower()
        if scheme not in ("http", "https"):
            raise UnsafeURL("Only http and https URLs are allowed", details={"scheme": scheme})
        if parts.username or parts.password:
            raise UnsafeURL("Credentials in URLs are not allowed")
        host = (parts.hostname or "").lower().rstrip(".")
        if not host:
            raise UnsafeURL("URL has no host")
        try:
            port = parts.port or (443 if scheme == "https" else 80)
        except ValueError as exc:
            raise UnsafeURL("Invalid port") from exc
        if port not in self.allowed_ports and not _host_matches(host, self.trusted_private_hosts):
            raise UnsafeURL("Port is not allowed", details={"port": port})
        internal_name = host in _METADATA_HOSTS or host.endswith((".internal", ".local")) or host == "localhost"
        if internal_name and not _host_matches(host, self.trusted_private_hosts):
            raise UnsafeURL("Internal hostnames are not allowed", details={"host": host})
        if self.denied_domains and _host_matches(host, self.denied_domains):
            raise UnsafeURL("Domain is denied by policy", details={"host": host})
        if self.allowed_domains and not _host_matches(host, self.allowed_domains):
            raise UnsafeURL("Domain is not in the allowlist", details={"host": host})
        return scheme, host, port

    async def check_url(self, url: str) -> VettedURL:
        scheme, host, port = self.check_syntax(url)
        trusted = _host_matches(host, self.trusted_private_hosts)
        try:
            literal = ipaddress.ip_address(host)
            addresses: tuple[str, ...] = (str(literal),)
        except ValueError:
            try:
                infos = await asyncio.wait_for(
                    asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM), timeout=5
                )
            except (OSError, TimeoutError) as exc:
                raise UnsafeURL("Host could not be resolved", details={"host": host}) from exc
            addresses = tuple(dict.fromkeys(str(info[4][0]) for info in infos))
        if not addresses:
            raise UnsafeURL("Host could not be resolved", details={"host": host})
        if not (self.allow_private_network or trusted):
            for address in addresses:
                if not ip_is_public(address):
                    raise UnsafeURL("URL resolves to a private or reserved address", details={"host": host})
        return VettedURL(url=url, scheme=scheme, host=host, port=port, addresses=addresses)


def default_policy(*, allowed: list[str] | None = None, denied: list[str] | None = None,
                   trusted_private_hosts: list[str] | None = None) -> EgressPolicy:
    from app.core.config import get_settings

    settings = get_settings()
    return EgressPolicy(
        allowed_domains=list(allowed or []),
        denied_domains=list(denied or []),
        allow_private_network=settings.allow_private_network_egress,
        trusted_private_hosts=list(trusted_private_hosts or []),
    )
