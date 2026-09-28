from __future__ import annotations

import uuid
from typing import Any

from app.notifications.service import deliver
from app.workers.jobs.registry import JobContext, job
from app.workers.queues.base import RetryJob


@job("notification.deliver")
async def deliver_notification(ctx: JobContext, payload: dict[str, Any]) -> None:
    async with ctx.session_factory() as session:
        session.info["tenant_id"] = uuid.UUID(payload["tenant_id"])
        try:
            await deliver(session, uuid.UUID(payload["notification_id"]))
        except Exception as exc:
            raise RetryJob(f"delivery failed: {type(exc).__name__}", delay_seconds=30 * ctx.attempt) from exc


@job("webhook.process")
async def process_webhook(ctx: JobContext, payload: dict[str, Any]) -> None:
    from app.integrations.webhooks import WebhookEnvelope, process_delivery

    async with ctx.session_factory() as session:
        session.info["system"] = True
        await process_delivery(session, payload["provider"], WebhookEnvelope.model_validate(payload["envelope"]))
