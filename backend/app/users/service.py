from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit import service as audit
from app.audit.service import AuditCategory
from app.auth.service import revoke_all_sessions
from app.common.context import RequestContext
from app.core.exceptions import NotFound, Unauthorized, ValidationFailed
from app.core.security import verify_password
from app.users.models import User, UserStatus
from app.users.schemas import UserUpdate
from app.workers.queues.base import JobSpec, Queues
from app.workers.queues.postgres import get_job_queue


async def get_me(session: AsyncSession, ctx: RequestContext) -> User:
    user = await session.get(User, ctx.user_id)
    if user is None:
        raise NotFound("User not found")
    return user


async def update_me(session: AsyncSession, ctx: RequestContext, body: UserUpdate) -> User:
    user = await get_me(session, ctx)
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for key, value in changes.items():
        setattr(user, key, value)
    audit.record(session, ctx=ctx, category=AuditCategory.DATA, action="user.update",
                 metadata={"fields": sorted(changes)})
    await session.commit()
    return user


async def request_account_deletion(session: AsyncSession, ctx: RequestContext, password: str | None,
                                   confirm: bool) -> None:
    """Right-to-delete: lock the account now, purge data asynchronously (memories,
    embeddings, files + objects, integrations (revoked at the provider), tasks, and
    personal organizations). Audit records are retained per the retention policy."""
    if not confirm:
        raise ValidationFailed("Deletion must be explicitly confirmed")
    user = await get_me(session, ctx)
    if user.password_hash is not None and not verify_password(password or "", user.password_hash):
        raise Unauthorized("Invalid credentials", code="invalid_credentials")
    user.status = UserStatus.DELETION_PENDING
    await revoke_all_sessions(session, user.id, reason="account_deletion")
    await get_job_queue().enqueue(session, JobSpec(
        queue=Queues.MAINTENANCE, job_type="account.purge", payload={"user_id": str(user.id)},
        dedupe_key=f"account.purge:{user.id}", max_attempts=10))
    audit.record(session, ctx=ctx, category=AuditCategory.SECURITY, action="user.deletion_requested")
    await session.commit()
