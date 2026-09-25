from __future__ import annotations

from fastapi import APIRouter, Request

from app.api.deps import AppSettings, DbSession, Now, rate_limit
from app.models import ContactRequest
from app.schemas.contact import ContactIn, ContactOut
from app.services.network import client_ip

router = APIRouter(prefix="/v1", tags=["contact"])


@router.post(
    "/contact",
    response_model=ContactOut,
    dependencies=[rate_limit("contact", "rate_limit_contact_per_hour", 3600)],
)
def request_access(
    body: ContactIn, request: Request, db: DbSession, settings: AppSettings, now: Now
) -> ContactOut:
    db.add(
        ContactRequest(
            name=body.name,
            email=body.email,
            company=body.company or None,
            message=body.message or None,
            ip_hash=request.app.state.pseudonymize(
                client_ip(request, settings.trusted_proxy_count) or "unknown"
            ),
            created_at=now,
        )
    )
    db.commit()
    return ContactOut()
