"""Verification sessions: created and challenged by the widget, listed by the dashboard."""

from __future__ import annotations

from fastapi import APIRouter, Path, Request
from sqlalchemy import select

from app.api.deps import AppSettings, CurrentProject, DbSession, Now, rate_limit
from app.models import VerificationSession
from app.schemas.dashboard import EventOutcome, SessionRecordOut
from app.schemas.verification import (
    ChallengeInfo,
    ChallengeResponseIn,
    CreateSessionIn,
    VerificationResultOut,
    VerificationSessionOut,
)
from app.services import dashboard_service
from app.services.network import request_meta
from app.services.session_service import create_session, resolve_project
from app.services.verification_engine import EngineDeps, submit_challenge

router = APIRouter(prefix="/v1/sessions", tags=["verification"])


@router.post(
    "",
    status_code=201,
    response_model=VerificationSessionOut,
    dependencies=[rate_limit("sessions", "rate_limit_sessions_per_minute", 60)],
)
def create_verification_session(
    body: CreateSessionIn, request: Request, db: DbSession, settings: AppSettings, now: Now
) -> VerificationSessionOut:
    project = resolve_project(db, body.site_key, settings)
    request.state.log_project_id = project.id
    session = create_session(
        db,
        project,
        action=body.action,
        meta=request_meta(request, settings.trusted_proxy_count),
        pseudonymize=request.app.state.pseudonymize,
        settings=settings,
        now=now,
    )
    db.commit()
    return VerificationSessionOut(
        id=session.id,
        status=session.status,
        challenge=ChallengeInfo(
            type=session.challenge_type, ttl_seconds=settings.verification_session_ttl_seconds
        ),
        created_at=session.created_at,
        expires_at=session.expires_at,
    )


@router.post(
    "/{session_id}/challenge",
    response_model=VerificationResultOut,
    dependencies=[rate_limit("challenges", "rate_limit_challenges_per_minute", 60)],
)
def submit_verification_challenge(
    body: ChallengeResponseIn,
    request: Request,
    db: DbSession,
    settings: AppSettings,
    now: Now,
    session_id: str = Path(min_length=1, max_length=64),
) -> VerificationResultOut:
    project_id = db.scalar(
        select(VerificationSession.project_id).where(VerificationSession.id == session_id)
    )
    if project_id:
        request.state.log_project_id = project_id
    deps = EngineDeps(
        settings=settings,
        pseudonymize=request.app.state.pseudonymize,
        network=request.app.state.network,
    )
    _, result = submit_challenge(
        db, session_id, body, request_meta(request, settings.trusted_proxy_count), deps, now
    )
    return result


@router.get("", response_model=list[SessionRecordOut])
def list_verification_sessions(
    project: CurrentProject, db: DbSession, outcome: EventOutcome | None = None
) -> list[SessionRecordOut]:
    return dashboard_service.list_sessions(db, project.id, outcome)
