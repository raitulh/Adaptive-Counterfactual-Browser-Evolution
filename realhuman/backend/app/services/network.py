"""Client network context: IP extraction, IP classification, browser request metadata."""

from __future__ import annotations

import ipaddress
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from starlette.requests import Request

IpNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network
IpKind = Literal["public", "private", "loopback", "reserved", "unknown"]


def client_ip(request: Request, trusted_proxy_count: int) -> str | None:
    """
    The caller's IP. With N trusted proxies, the Nth entry from the right of
    X-Forwarded-For is the first address no proxy of ours wrote, so it can't be
    spoofed by the client.
    """
    if trusted_proxy_count > 0:
        forwarded = request.headers.get("x-forwarded-for", "")
        hops = [hop.strip() for hop in forwarded.split(",") if hop.strip()]
        if len(hops) >= trusted_proxy_count:
            candidate = hops[-trusted_proxy_count]
            if _valid_ip(candidate):
                return candidate
    return request.client.host if request.client else None


def _valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
    except ValueError:
        return False
    return True


@dataclass(frozen=True)
class NetworkInfo:
    kind: IpKind
    blocklisted: bool = False
    datacenter: bool = False


class NetworkClassifier:
    """
    Static reputation from configured CIDR lists. Swap in a commercial IP
    intelligence feed (ASN, proxy/VPN, Tor) by providing the same interface.
    """

    def __init__(self, blocklist: list[str], datacenter: list[str]) -> None:
        self._blocklist = [ipaddress.ip_network(cidr, strict=False) for cidr in blocklist]
        self._datacenter = [ipaddress.ip_network(cidr, strict=False) for cidr in datacenter]

    def classify(self, ip: str | None) -> NetworkInfo:
        if not ip:
            return NetworkInfo(kind="unknown")
        try:
            address = ipaddress.ip_address(ip)
        except ValueError:
            return NetworkInfo(kind="unknown")
        if address.is_loopback:
            kind: IpKind = "loopback"
        elif address.is_private:
            kind = "private"
        elif not address.is_global:
            kind = "reserved"
        else:
            kind = "public"
        return NetworkInfo(
            kind=kind,
            blocklisted=any(address in network for network in self._blocklist),
            datacenter=any(address in network for network in self._datacenter),
        )


@dataclass(frozen=True)
class RequestMeta:
    """What the verification engine may know about one HTTP request."""

    ip: str | None
    user_agent: str
    accept_language: str | None
    origin: str
    sec_fetch_mode: str | None
    sec_fetch_site: str | None


def origin_host(request: Request) -> str:
    """`app.example.com` from the Origin (or Referer) header; `unknown` when absent."""
    for header in ("origin", "referer"):
        value = request.headers.get(header)
        if value and value != "null":
            netloc = urlsplit(value).netloc
            if netloc:
                return netloc[:255]
    return "unknown"


def request_meta(request: Request, trusted_proxy_count: int) -> RequestMeta:
    headers = request.headers
    return RequestMeta(
        ip=client_ip(request, trusted_proxy_count),
        user_agent=headers.get("user-agent", "")[:512],
        accept_language=headers.get("accept-language") or None,
        origin=origin_host(request),
        sec_fetch_mode=headers.get("sec-fetch-mode"),
        sec_fetch_site=headers.get("sec-fetch-site"),
    )
