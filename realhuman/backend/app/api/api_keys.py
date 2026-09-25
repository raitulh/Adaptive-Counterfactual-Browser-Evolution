from __future__ import annotations

from fastapi import APIRouter, Path, Response
from sqlalchemy import func, select

from app.api.deps import CurrentProject, DbSession, Now, TrustedOrigin
from app.errors import ApiError
from app.models import ApiKey
from app.schemas.dashboard import ApiKeyOut, CreateApiKeyIn, CreatedApiKeyOut
from app.security.api_keys import generate_secret_key, mask_secret
from app.security.crypto import sha256_hex

router = APIRouter(prefix="/v1/api-keys", tags=["api-keys"])

MAX_ACTIVE_KEYS = 25


@router.get("", response_model=list[ApiKeyOut])
def list_keys(project: CurrentProject, db: DbSession) -> list[ApiKey]:
    return list(
        db.scalars(
            select(ApiKey)
            .where(ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None))
            .order_by(ApiKey.created_at.desc(), ApiKey.id)
        ).all()
    )


@router.post("", status_code=201, response_model=CreatedApiKeyOut, dependencies=[TrustedOrigin])
def create_key(
    body: CreateApiKeyIn, project: CurrentProject, db: DbSession, now: Now
) -> CreatedApiKeyOut:
    active = db.scalar(
        select(func.count())
        .select_from(ApiKey)
        .where(ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None))
    )
    if (active or 0) >= MAX_ACTIVE_KEYS:
        raise ApiError(422, "VALIDATION_ERROR", "Revoke an unused key before creating another.")
    secret = generate_secret_key(body.environment)
    key = ApiKey(
        project_id=project.id,
        name=body.name,
        environment=body.environment,
        key_hash=sha256_hex(secret),
        masked_key=mask_secret(secret),
        created_at=now,
    )
    db.add(key)
    db.commit()
    # The only time the secret leaves the server.
    return CreatedApiKeyOut(**ApiKeyOut.model_validate(key).model_dump(), secret=secret)


@router.delete("/{key_id}", status_code=204, dependencies=[TrustedOrigin])
def revoke_key(
    project: CurrentProject, db: DbSession, now: Now, key_id: str = Path(max_length=64)
) -> Response:
    key = db.scalar(
        select(ApiKey).where(
            ApiKey.id == key_id, ApiKey.project_id == project.id, ApiKey.revoked_at.is_(None)
        )
    )
    if key is None:
        raise ApiError(404, "NOT_FOUND", "API key not found.")
    key.revoked_at = now
    db.commit()
    return Response(status_code=204)
