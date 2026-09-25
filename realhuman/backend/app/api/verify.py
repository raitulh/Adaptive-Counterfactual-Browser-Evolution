"""Server-to-server token redemption."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.api.deps import AuthenticatedKey, DbSession, Now
from app.schemas.verification import VerifyIn, VerifyOut
from app.services.verification_engine import redeem_token

router = APIRouter(prefix="/v1", tags=["verification"])


@router.post("/verify", response_model=VerifyOut)
def verify(
    body: VerifyIn, request: Request, key: AuthenticatedKey, db: DbSession, now: Now
) -> VerifyOut:
    """Redeems a verification token once. A second redemption returns 410."""
    request.state.log_project_id = key.project_id
    return redeem_token(db, key, body.token, now)
