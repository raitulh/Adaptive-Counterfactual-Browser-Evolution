"""Idempotent notifications (in-app + e-mail; push/SMS/webhook plug into ``Channel``)."""

from __future__ import annotations

import asyncio
import logging
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from typing import Any, Protocol

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.enums import StrEnum
from app.common.events import EventType, user_channel
from app.common.ids import new_id
from app.common.outbox import add_outbox_event
from app.common.time import utcnow
from app.core.config import get_settings
from app.notifications.models import Notification
from app.workers.queues.base import JobSpec, Queues

logger = logging.getLogger(__name__)


class NotificationEvent(StrEnum):
    APPROVAL_REQUIRED = "approval_required"
    INPUT_REQUIRED = "input_required"
    TASK_COMPLETED = "task_completed"
    TASK_FAILED = "task_failed"
    AUTOMATION_FAILED = "automation_failed"
    CONNECTION_EXPIRED = "connection_expired"
    SECURITY_ALERT = "security_alert"


# Events important enough to also send by e-mail (when SMTP is configured).
EMAIL_EVENTS = {NotificationEvent.APPROVAL_REQUIRED, NotificationEvent.TASK_FAILED,
                NotificationEvent.CONNECTION_EXPIRED, NotificationEvent.SECURITY_ALERT,
                NotificationEvent.AUTOMATION_FAILED, NotificationEvent.INPUT_REQUIRED}


async def notify(session: AsyncSession, *, tenant_id: uuid.UUID, user_id: uuid.UUID, event: NotificationEvent,
                 title: str, body: str, data: dict[str, Any] | None = None, idempotency_key: str,
                 channels: list[str] | None = None) -> None:
    """Stage notifications in the caller's transaction. Duplicate keys are ignored, so
    retries and replays never produce duplicate notifications."""
    from app.workers.queues.postgres import get_job_queue

    settings = get_settings()
    if channels is None:
        channels = ["in_app"] + (["email"] if event in EMAIL_EVENTS and settings.smtp_host else [])
    for channel in channels:
        nid = new_id()
        inserted = (await session.execute(
            insert(Notification).values(
                id=nid, tenant_id=tenant_id, user_id=user_id, channel=channel, event_type=event.value,
                title=title[:300], body=body[:5000], data=data or {},
                status="delivered" if channel == "in_app" else "pending", idempotency_key=idempotency_key[:200],
            ).on_conflict_do_nothing(index_elements=["tenant_id", "user_id", "channel", "idempotency_key"])
            .returning(Notification.id),
            execution_options={"skip_tenant_scope": True},
        )).scalar_one_or_none()
        if inserted is None:
            continue
        if channel == "in_app":
            add_outbox_event(session, topic=user_channel(user_id), event_type=EventType.NOTIFICATION_CREATED,
                             payload={"notification_id": str(nid), "event": event.value, "title": title[:300]},
                             tenant_id=tenant_id)
        else:
            await get_job_queue().enqueue(session, JobSpec(
                queue=Queues.NOTIFICATIONS, job_type="notification.deliver",
                payload={"notification_id": str(nid), "tenant_id": str(tenant_id)}, tenant_id=tenant_id,
                dedupe_key=f"notification:{nid}"))


class Channel(Protocol):
    async def send(self, to: str, title: str, body: str) -> None: ...


class EmailChannel:
    """SMTP delivery (runs the blocking client in a thread)."""

    async def send(self, to: str, title: str, body: str) -> None:
        settings = get_settings()
        if not settings.smtp_host:
            raise RuntimeError("SMTP is not configured")
        message = EmailMessage()
        message["From"] = settings.smtp_from_address
        message["To"] = to
        message["Subject"] = f"[{settings.app_name}] {title}"
        message.set_content(body)

        def _send() -> None:
            assert settings.smtp_host is not None
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
                if settings.smtp_use_tls:
                    smtp.starttls(context=ssl.create_default_context())
                if settings.smtp_username:
                    smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
                smtp.send_message(message)

        await asyncio.to_thread(_send)


async def deliver(session: AsyncSession, notification_id: uuid.UUID, channel: Channel | None = None) -> str:
    from app.users.models import User

    note = await session.get(Notification, notification_id, with_for_update=True)
    if note is None or note.status in ("sent", "delivered", "skipped"):
        return "noop"
    user = await session.get(User, note.user_id)
    if user is None or user.deleted_at is not None:
        note.status = "skipped"
        await session.commit()
        return "skipped"
    note.attempts += 1
    try:
        await (channel or EmailChannel()).send(user.email, note.title, note.body)
    except Exception as exc:
        note.last_error = type(exc).__name__
        note.status = "failed" if note.attempts >= 5 else "pending"
        await session.commit()
        if note.status == "pending":
            raise
        return "failed"
    note.status = "sent"
    note.sent_at = utcnow()
    await session.commit()
    return "sent"
