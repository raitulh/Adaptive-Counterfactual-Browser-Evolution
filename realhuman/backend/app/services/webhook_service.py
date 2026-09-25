"""
Webhooks: an outbox of deliveries, signed with HMAC-SHA256 and retried with backoff.

Each delivery carries:
    RealHuman-Event:      verification.completed
    RealHuman-Delivery:   whd_…
    RealHuman-Signature:  t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>

Receivers should recompute the signature over the raw body, compare in
constant time, and reject timestamps older than a few minutes.
"""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import json
import logging
import secrets
import socket
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlsplit

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session, sessionmaker

from app.clock import Clock
from app.config import Settings
from app.models import VerificationEvent, WebhookDelivery, WebhookEndpoint
from app.schemas.common import to_iso
from app.security.crypto import SecretBox

logger = logging.getLogger("realhuman.webhooks")

EVENT_TYPE_FOR_OUTCOME = {
    "verified": "verification.completed",
    "step_up": "verification.step_up",
    "blocked": "verification.blocked",
    "expired": "session.expired",
}
BACKOFF_SECONDS = (10, 60, 300, 1800, 7200, 21600)
# A claimed delivery is invisible to other workers for this long.
CLAIM_LEASE = timedelta(seconds=60)
USER_AGENT = "RealHuman-Webhooks/1.0"

Resolver = Callable[[str, int], list[str]]


def generate_signing_secret() -> str:
    return f"whsec_{secrets.token_urlsafe(24)}"


def sign_payload(secret: str, timestamp: int, body: bytes) -> str:
    message = f"{timestamp}.".encode() + body
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def signature_header(secret: str, timestamp: int, body: bytes) -> str:
    return f"t={timestamp},v1={sign_payload(secret, timestamp, body)}"


def obviously_private_host(url: str) -> bool:
    """Cheap check at creation time; delivery re-checks every resolved address."""
    host = (urlsplit(url).hostname or "").lower()
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        return not ipaddress.ip_address(host).is_global
    except ValueError:
        return False


def enqueue_event(db: Session, event: VerificationEvent, now: datetime) -> int:
    """Adds one delivery per active endpoint subscribed to the event's type."""
    event_type = EVENT_TYPE_FOR_OUTCOME[event.outcome]
    endpoints = db.scalars(
        select(WebhookEndpoint).where(
            WebhookEndpoint.project_id == event.project_id, WebhookEndpoint.status == "active"
        )
    ).all()
    payload = {
        "id": event.id,
        "type": event_type,
        "createdAt": to_iso(event.created_at),
        "data": {
            "sessionId": event.session_id,
            "outcome": event.outcome,
            "risk": event.risk,
            "score": event.score,
            "action": event.action,
            "origin": event.origin,
        },
    }
    count = 0
    for endpoint in endpoints:
        if event_type in endpoint.events:
            db.add(
                WebhookDelivery(
                    endpoint_id=endpoint.id,
                    event_id=event.id,
                    event_type=event_type,
                    payload=payload,
                    created_at=now,
                    next_attempt_at=now,
                )
            )
            count += 1
    return count


def _resolve(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    return [str(info[4][0]) for info in infos]


@dataclass(frozen=True)
class _Claimed:
    delivery_id: str
    event_type: str
    url: str
    secret: str
    payload: dict


@dataclass(frozen=True)
class _Result:
    ok: bool
    status_code: int | None = None
    error: str | None = None


class WebhookDispatcher:
    def __init__(
        self,
        session_factory: sessionmaker[Session],
        settings: Settings,
        secret_box: SecretBox,
        clock: Clock,
        client: httpx.Client | None = None,
        resolver: Resolver = _resolve,
    ) -> None:
        self._sessions = session_factory
        self._settings = settings
        self._box = secret_box
        self._clock = clock
        self._client = client or httpx.Client(
            timeout=settings.webhook_timeout_seconds, follow_redirects=False
        )
        self._resolver = resolver

    def close(self) -> None:
        self._client.close()

    def run_once(self, limit: int = 25) -> int:
        """Delivers due webhooks. Returns how many were attempted."""
        claimed = self._claim(limit)
        for item in claimed:
            self._record(item, self._send(item))
        return len(claimed)

    def _claim(self, limit: int) -> list[_Claimed]:
        now = self._clock.now()
        claimed: list[_Claimed] = []
        with self._sessions() as db:
            deliveries = db.scalars(
                select(WebhookDelivery)
                .where(WebhookDelivery.status == "pending", WebhookDelivery.next_attempt_at <= now)
                .order_by(WebhookDelivery.next_attempt_at)
                .limit(limit)
                .with_for_update(skip_locked=True)
            ).all()
            for delivery in deliveries:
                delivery.next_attempt_at = now + CLAIM_LEASE
                endpoint = delivery.endpoint
                try:
                    secret = self._box.decrypt(endpoint.secret_encrypted)
                except ValueError:
                    delivery.status = "failed"
                    delivery.last_error = "Signing secret could not be decrypted."
                    continue
                claimed.append(
                    _Claimed(
                        delivery.id, delivery.event_type, endpoint.url, secret, delivery.payload
                    )
                )
            db.commit()
        return claimed

    def _send(self, item: _Claimed) -> _Result:
        parts = urlsplit(item.url)
        if not self._settings.webhook_allow_private_targets:
            try:
                addresses = self._resolver(parts.hostname or "", parts.port or 443)
            except OSError:
                return _Result(False, error="DNS resolution failed.")
            if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
                return _Result(False, error="Endpoint resolves to a non-public address.")

        body = json.dumps(item.payload, separators=(",", ":")).encode()
        timestamp = int(self._clock.now().timestamp())
        headers = {
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
            "RealHuman-Event": item.event_type,
            "RealHuman-Delivery": item.delivery_id,
            "RealHuman-Signature": signature_header(item.secret, timestamp, body),
        }
        try:
            response = self._client.post(item.url, content=body, headers=headers)
        except httpx.TimeoutException:
            return _Result(False, error="Request timed out.")
        except httpx.HTTPError as error:
            return _Result(False, error=f"Request failed: {type(error).__name__}.")
        if 200 <= response.status_code < 300:
            return _Result(True, response.status_code)
        return _Result(False, response.status_code, f"Endpoint returned {response.status_code}.")

    def _record(self, item: _Claimed, result: _Result) -> None:
        now = self._clock.now()
        with self._sessions() as db:
            delivery = db.get(WebhookDelivery, item.delivery_id)
            if delivery is None:  # endpoint removed meanwhile
                return
            delivery.attempts += 1
            delivery.last_status_code = result.status_code
            if result.ok:
                delivery.status = "succeeded"
                delivery.delivered_at = now
                delivery.next_attempt_at = None
                delivery.last_error = None
            elif delivery.attempts >= self._settings.webhook_max_attempts:
                delivery.status = "failed"
                delivery.next_attempt_at = None
                delivery.last_error = (result.error or "")[:255]
            else:
                delay = BACKOFF_SECONDS[min(delivery.attempts - 1, len(BACKOFF_SECONDS) - 1)]
                delivery.next_attempt_at = now + timedelta(seconds=delay)
                delivery.last_error = (result.error or "")[:255]
            db.commit()
        if not result.ok:
            logger.info(
                "webhook delivery failed",
                extra={"delivery_id": item.delivery_id, "status_code": result.status_code},
            )
