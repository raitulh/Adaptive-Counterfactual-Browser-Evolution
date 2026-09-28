"""Audit recording.

``record`` stages the audit row in the caller's transaction, so the audit
trail and the audited state change commit (or roll back) together.
``record_independent`` writes in its own transaction for events whose
surrounding transaction is rolled back (failed logins, denied actions).
Metadata is always passed through secret redaction first.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.audit.models import AuditLog
from app.common.context import RequestContext
from app.common.redaction import redact
from app.common.sanitize import bound_structure
from app.core.logging import request_id_var, trace_id_var

logger = logging.getLogger(__name__)


class AuditCategory:
    SECURITY = "security"
    AUTH = "auth"
    TASK = "task"
    TOOL = "tool"
    APPROVAL = "approval"
    INTEGRATION = "integration"
    ADMIN = "admin"
    DATA = "data"
    MEMORY = "memory"
    AUTOMATION = "automation"
    BILLING = "billing"
    EXPERIMENT = "experiment"


def build_audit(
    *,
    category: str,
    action: str,
    status: str = "success",
    ctx: RequestContext | None = None,
    tenant_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    actor_type: str | None = None,
    resource_type: str | None = None,
    resource_id: str | uuid.UUID | None = None,
    task_id: uuid.UUID | None = None,
    step_id: uuid.UUID | None = None,
    tool_name: str | None = None,
    approval_id: uuid.UUID | None = None,
    result_summary: str | None = None,
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    return AuditLog(
        tenant_id=tenant_id or (ctx.tenant_id if ctx else None),
        user_id=user_id or (ctx.user_id if ctx else None),
        actor_type=actor_type or (ctx.actor_type if ctx else "system"),
        category=category,
        action=action,
        status=status,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id is not None else None,
        task_id=task_id,
        step_id=step_id,
        tool_name=tool_name,
        approval_id=approval_id,
        ip_address=ip or (ctx.ip if ctx else None),
        user_agent=(user_agent or (ctx.user_agent if ctx else None) or None),
        request_id=request_id_var.get(),
        trace_id=trace_id_var.get(),
        result_summary=(result_summary or None) and str(redact(result_summary))[:2000],
        metadata_=bound_structure(redact(metadata or {}), max_depth=5, max_items=40, max_string=1000),
    )


def record(session: AsyncSession, **kwargs: Any) -> AuditLog:
    entry = build_audit(**kwargs)
    if entry.user_agent:
        entry.user_agent = entry.user_agent[:300]
    session.add(entry)
    return entry


async def record_independent(**kwargs: Any) -> None:
    from app.core.database import get_session_factory

    try:
        async with get_session_factory()() as session:
            session.info["system"] = True
            record(session, **kwargs)
            await session.commit()
    except Exception:  # auditing must never mask the original outcome, but must be visible
        logger.exception("failed to write independent audit record", extra={"action": kwargs.get("action")})
