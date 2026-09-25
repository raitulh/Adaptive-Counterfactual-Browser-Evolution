"""
Verification engine: evaluates a challenge submission end to end.

    session (locked) → validity checks → client/network/rate context
        → signal engine → risk engine (project policy) → persist signals,
        decision, event, webhooks → single-use token on allow
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.errors import ApiError
from app.models import ApiKey, ProjectSettings, SignalRecord, VerificationEvent, VerificationSession
from app.schemas.verification import (
    ChallengeResponseIn,
    SignalOut,
    VerificationResultOut,
    VerifyOut,
)
from app.security.crypto import Pseudonymizer, sha256_hex
from app.services.network import NetworkClassifier, RequestMeta
from app.services.risk_engine import Policy, RiskDecision, classify_signal, decide
from app.services.session_service import ACTIVE_STATUSES, expire_session, record_event
from app.services.signal_engine import (
    ClientFingerprint,
    RateStats,
    SignalContext,
    evaluate_signals,
)

OUTCOME_FOR_DECISION = {"allow": "verified", "step_up": "step_up", "deny": "blocked"}


@dataclass(frozen=True)
class EngineDeps:
    settings: Settings
    pseudonymize: Pseudonymizer
    network: NetworkClassifier


def _rate_stats(db: Session, ip_hash: str, now: datetime) -> RateStats:
    ten_minutes_ago = now - timedelta(minutes=10)
    hour_ago = now - timedelta(hours=1)
    sessions = db.scalar(
        select(func.count())
        .select_from(VerificationSession)
        .where(
            VerificationSession.ip_hash == ip_hash,
            VerificationSession.created_at >= ten_minutes_ago,
        )
    )
    decisions = (
        select(func.count())
        .select_from(VerificationEvent)
        .join(VerificationSession, VerificationSession.id == VerificationEvent.session_id)
        .where(VerificationSession.ip_hash == ip_hash)
    )
    challenges = db.scalar(
        decisions.where(
            VerificationEvent.created_at >= ten_minutes_ago,
            VerificationEvent.outcome != "expired",
        )
    )
    blocked = db.scalar(
        decisions.where(
            VerificationEvent.created_at >= hour_ago, VerificationEvent.outcome == "blocked"
        )
    )
    return RateStats(
        sessions_from_ip_10m=sessions or 0,
        # This submission is not recorded yet, so count it.
        challenges_from_ip_10m=(challenges or 0) + 1,
        blocked_from_ip_1h=blocked or 0,
    )


def submit_challenge(
    db: Session,
    session_id: str,
    response: ChallengeResponseIn,
    meta: RequestMeta,
    deps: EngineDeps,
    now: datetime,
) -> tuple[VerificationSession, VerificationResultOut]:
    settings = deps.settings
    session = db.scalar(
        select(VerificationSession).where(VerificationSession.id == session_id).with_for_update()
    )
    if session is None:
        raise ApiError(404, "NOT_FOUND", "Unknown verification session.")

    if session.status in ACTIVE_STATUSES and now >= session.expires_at:
        expire_session(db, session, now)
        db.commit()
        raise ApiError(410, "SESSION_EXPIRED")
    if session.status not in ACTIVE_STATUSES or session.attempts >= settings.max_challenge_attempts:
        raise ApiError(
            410,
            "SESSION_EXPIRED",
            "This verification session is no longer active. Start a new one.",
        )

    pseudonymize = deps.pseudonymize
    current = ClientFingerprint(
        ip_hash=pseudonymize(meta.ip or "unknown"),
        ua_hash=pseudonymize(meta.user_agent),
        lang_hash=pseudonymize(meta.accept_language),
        origin=meta.origin,
    )
    started = ClientFingerprint(
        ip_hash=session.ip_hash,
        ua_hash=session.ua_hash,
        lang_hash=session.lang_hash,
        origin=session.origin,
    )
    context = SignalContext(
        response=response,
        session_age_ms=int((now - session.created_at).total_seconds() * 1000),
        prior_attempts=session.attempts,
        started=started,
        current=current,
        meta=meta,
        network=deps.network.classify(meta.ip),
        rates=_rate_stats(db, current.ip_hash or "", now),
        hold_required_ms=settings.hold_duration_ms,
    )
    evaluations = evaluate_signals(context)

    project_settings = db.get(ProjectSettings, session.project_id)
    policy = (
        Policy(project_settings.allow_threshold, project_settings.step_up_threshold)
        if project_settings
        else Policy()
    )
    result = decide(evaluations, policy)
    attempt = session.attempts + 1
    if result.decision == "step_up" and attempt >= settings.max_challenge_attempts:
        # Out of step-up attempts: a session that never reaches "allow" is blocked.
        result = RiskDecision("deny", result.score, "high")

    signals = [
        SignalOut(
            id=evaluation.id,
            label=evaluation.label,
            status=classify_signal(evaluation.score),
            score=evaluation.score,
            weight=evaluation.weight,
            detail=evaluation.detail,
        )
        for evaluation in evaluations
    ]
    for evaluation, signal in zip(evaluations, signals, strict=True):
        db.add(
            SignalRecord(
                session_id=session.id,
                attempt=attempt,
                signal_id=signal.id,
                label=signal.label,
                status=signal.status,
                score=signal.score,
                weight=signal.weight,
                detail=signal.detail,
                factors=[factor.as_dict() for factor in evaluation.factors],
                created_at=now,
            )
        )

    verified = result.decision == "allow"
    token: str | None = None
    session.attempts = attempt
    session.last_challenge = response.type
    session.decision = result.decision
    session.risk = result.risk
    session.score = result.score
    session.outcome = OUTCOME_FOR_DECISION[result.decision]
    session.decided_at = now
    session.status = "challenged" if result.decision == "step_up" else "completed"
    if verified:
        token = f"rh_vt_{secrets.token_urlsafe(24)}"
        session.token_hash = sha256_hex(token)
        session.token_expires_at = now + timedelta(seconds=settings.verification_token_ttl_seconds)

    record_event(db, session, session.outcome, now)
    db.commit()

    return session, VerificationResultOut(
        session_id=session.id,
        verified=verified,
        decision=result.decision,
        risk=result.risk,
        score=result.score,
        token=token,
        signals=signals,
        decided_at=now,
    )


def redeem_token(db: Session, api_key: ApiKey, token: str, now: datetime) -> VerifyOut:
    """Server-side, single-use redemption of a verification token."""
    session = db.scalar(
        select(VerificationSession)
        .where(
            VerificationSession.token_hash == sha256_hex(token),
            VerificationSession.project_id == api_key.project_id,
        )
        .with_for_update()
    )
    if session is None or session.decided_at is None:
        raise ApiError(404, "NOT_FOUND", "Unknown verification token.")
    if session.token_redeemed_at is not None:
        raise ApiError(410, "SESSION_EXPIRED", "This token has already been redeemed.")
    if session.token_expires_at is None or session.token_expires_at <= now:
        raise ApiError(410, "SESSION_EXPIRED", "This token has expired.")

    session.token_redeemed_at = now
    db.commit()

    latest = [record for record in session.signals if record.attempt == session.attempts]
    return VerifyOut(
        session=session.id,
        verified=session.decision == "allow",
        decision=session.decision or "deny",
        risk=session.risk or "high",
        score=session.score or 0.0,
        action=session.action,
        origin=session.origin,
        signals=[
            SignalOut(
                id=record.signal_id,
                label=record.label,
                status=record.status,
                score=record.score,
                weight=record.weight,
                detail=record.detail,
            )
            for record in latest
        ],
        decided_at=session.decided_at,
        redeemed_at=now,
    )
