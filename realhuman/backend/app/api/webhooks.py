from __future__ import annotations

from fastapi import APIRouter, Path, Request, Response
from sqlalchemy import func, select

from app.api.deps import AppSettings, CurrentProject, DbSession, Now, TrustedOrigin
from app.errors import ApiError
from app.models import WebhookEndpoint
from app.schemas.dashboard import CreatedWebhookEndpointOut, CreateWebhookIn, WebhookEndpointOut
from app.services.webhook_service import generate_signing_secret, obviously_private_host

router = APIRouter(prefix="/v1/webhooks", tags=["webhooks"])

MAX_ENDPOINTS = 10


@router.get("", response_model=list[WebhookEndpointOut])
def list_endpoints(project: CurrentProject, db: DbSession) -> list[WebhookEndpoint]:
    return list(
        db.scalars(
            select(WebhookEndpoint)
            .where(WebhookEndpoint.project_id == project.id)
            .order_by(WebhookEndpoint.created_at.desc(), WebhookEndpoint.id)
        ).all()
    )


@router.post(
    "", status_code=201, response_model=CreatedWebhookEndpointOut, dependencies=[TrustedOrigin]
)
def create_endpoint(
    body: CreateWebhookIn,
    request: Request,
    project: CurrentProject,
    db: DbSession,
    settings: AppSettings,
    now: Now,
) -> CreatedWebhookEndpointOut:
    if not settings.webhook_allow_private_targets and obviously_private_host(body.url):
        raise ApiError(422, "VALIDATION_ERROR", "Webhook endpoints must be publicly reachable.")
    count = db.scalar(
        select(func.count())
        .select_from(WebhookEndpoint)
        .where(WebhookEndpoint.project_id == project.id)
    )
    if (count or 0) >= MAX_ENDPOINTS:
        raise ApiError(422, "VALIDATION_ERROR", "Remove an endpoint before adding another.")
    secret = generate_signing_secret()
    endpoint = WebhookEndpoint(
        project_id=project.id,
        url=body.url,
        events=list(body.events),
        status="active",
        secret_encrypted=request.app.state.secret_box.encrypt(secret),
        created_at=now,
    )
    db.add(endpoint)
    db.commit()
    return CreatedWebhookEndpointOut(
        **WebhookEndpointOut.model_validate(endpoint).model_dump(), signing_secret=secret
    )


@router.delete("/{endpoint_id}", status_code=204, dependencies=[TrustedOrigin])
def delete_endpoint(
    project: CurrentProject, db: DbSession, endpoint_id: str = Path(max_length=64)
) -> Response:
    endpoint = db.scalar(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id, WebhookEndpoint.project_id == project.id
        )
    )
    if endpoint is None:
        raise ApiError(404, "NOT_FOUND", "Webhook endpoint not found.")
    db.delete(endpoint)
    db.commit()
    return Response(status_code=204)
