"""Inbound webhooks: signature verification, replay protection, idempotent delivery.

Signature scheme (HMAC-SHA256, Stripe-style): the sender sets
``X-AgentOS-Timestamp: <unix seconds>`` and
``X-AgentOS-Signature: v1=<hex hmac_sha256(secret, f"{timestamp}.{raw_body}")>``.
Requests outside the tolerance window are rejected (replay), duplicate delivery
ids are acknowledged without re-processing, and processing happens in a worker.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.ids import new_id
from app.common.models import WebhookDelivery
from app.common.time import utcnow
from app.core.config import get_settings
from app.core.exceptions import ConfigurationMissing, Unauthorized

logger = logging.getLogger(__name__)

WebhookHandler = Callable[[AsyncSession, "WebhookEnvelope"], Awaitable[None]]
_HANDLERS: dict[tuple[str, str], WebhookHandler] = {}


class WebhookEnvelope(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(min_length=1, max_length=200)
    type: str = Field(min_length=1, max_length=100)
    data: dict[str, Any] = Field(default_factory=dict)


def secret_for(provider: str) -> str:
    settings = get_settings()
    if provider == "generic":
        secret = settings.webhook_signing_secret.get_secret_value()
        if secret:
            return secret
    raise ConfigurationMissing(f"Webhook provider '{provider}' is not configured")


def sign(secret: str, timestamp: int, body: bytes) -> str:
    mac = hmac.new(secret.encode(), f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()
    return f"v1={mac}"


def verify_signature(secret: str, body: bytes, timestamp_header: str | None, signature_header: str | None, *,
                     tolerance_seconds: int, now: float | None = None) -> None:
    if not timestamp_header or not signature_header:
        raise Unauthorized("Missing webhook signature", code="webhook_signature_missing")
    try:
        timestamp = int(timestamp_header)
    except ValueError as exc:
        raise Unauthorized("Invalid webhook timestamp", code="webhook_signature_invalid") from exc
    if abs((now or time.time()) - timestamp) > tolerance_seconds:
        raise Unauthorized("Webhook timestamp outside the allowed window", code="webhook_replay")
    expected = sign(secret, timestamp, body)
    candidates = [part.strip() for part in signature_header.split(",")]
    if not any(hmac.compare_digest(expected, c) for c in candidates):
        raise Unauthorized("Invalid webhook signature", code="webhook_signature_invalid")


async def record_delivery(session: AsyncSession, provider: str, envelope: WebhookEnvelope) -> bool:
    """Returns True for a first delivery, False for a duplicate (already recorded)."""
    inserted = (await session.execute(
        insert(WebhookDelivery).values(id=new_id(), provider=provider, delivery_id=envelope.id,
                                       event_type=envelope.type, status="received")
        .on_conflict_do_nothing(index_elements=["provider", "delivery_id"]).returning(WebhookDelivery.id)
    )).scalar_one_or_none()
    return inserted is not None


def register_handler(provider: str, event_type: str, handler: WebhookHandler) -> None:
    _HANDLERS[(provider, event_type)] = handler


async def process_delivery(session: AsyncSession, provider: str, envelope: WebhookEnvelope) -> str:
    handler = _HANDLERS.get((provider, envelope.type))
    outcome = "processed" if handler else "ignored"
    if handler is not None:
        await handler(session, envelope)
    else:
        logger.info("webhook without handler", extra={"provider": provider, "event_type": envelope.type})
    await session.execute(update(WebhookDelivery).where(WebhookDelivery.provider == provider,
                                                        WebhookDelivery.delivery_id == envelope.id)
                          .values(status=outcome, processed_at=utcnow()))
    await session.commit()
    return outcome
