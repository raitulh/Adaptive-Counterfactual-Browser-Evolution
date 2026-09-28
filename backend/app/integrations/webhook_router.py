from __future__ import annotations

from fastapi import APIRouter, Depends, Header, Path, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.api.dependencies import DbSession, ip_route_rate_limit
from app.core.config import get_settings
from app.core.database import set_system_scope
from app.core.exceptions import ValidationFailed
from app.integrations.webhooks import WebhookEnvelope, record_delivery, secret_for, verify_signature
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


@router.post("/{provider}", summary="Receive a signed webhook (verified, replay-protected, idempotent)",
             status_code=202, dependencies=[Depends(ip_route_rate_limit("webhook", "rate_limit_ip_per_minute"))],
             responses={401: {"description": "Bad/missing signature or replayed"},
                        503: {"description": "Provider not configured"}})
async def receive(request: Request, db: DbSession, provider: str = Path(pattern=r"^[a-z][a-z0-9_]{1,30}$"),
                  x_agentos_timestamp: str | None = Header(None), x_agentos_signature: str | None = Header(None)
                  ) -> JSONResponse:
    settings = get_settings()
    body = await request.body()
    verify_signature(secret_for(provider), body, x_agentos_timestamp, x_agentos_signature,
                     tolerance_seconds=settings.webhook_tolerance_seconds)
    try:
        envelope = WebhookEnvelope.model_validate_json(body)
    except ValidationError as exc:
        raise ValidationFailed("Malformed webhook payload") from exc
    set_system_scope(db)
    if not await record_delivery(db, provider, envelope):
        await db.rollback()
        return JSONResponse({"status": "duplicate", "id": envelope.id}, status_code=200)
    await get_job_queue().enqueue(db, JobSpec(queue=Queues.NOTIFICATIONS, job_type="webhook.process",
                                              payload={"provider": provider, "envelope": envelope.model_dump()},
                                              dedupe_key=f"webhook:{provider}:{envelope.id}"))
    await db.commit()
    return JSONResponse({"status": "accepted", "id": envelope.id}, status_code=202)
