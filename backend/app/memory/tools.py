"""Memory tools: ``memory.search`` (read) and ``memory.save`` (write, verified by read-back).

Each call opens its own short tenant-scoped session. ``memory.search`` embeds the query before
touching the database, and ``memory.save`` does no network I/O, so no transaction is ever held
open across a network call.
"""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.common.enums import PermissionLevel, RiskLevel, TrustLevel
from app.core.exceptions import ToolInputInvalid, ValidationFailed
from app.memory import service
from app.memory.models import MemorySourceType, MemoryStatus, MemoryType
from app.memory.schemas import Freshness
from app.tools.base import (
    IdempotencyStrategy,
    ReconcileOutcome,
    ReconcileStatus,
    RetryPolicy,
    Tool,
    ToolContext,
    ToolResult,
    ToolSpec,
)
from app.verification.types import Difference, VerificationMethod, VerificationOutcome

# A task-saved memory is trusted less than what the user states directly (1.0) ...
TOOL_SAVE_CONFIDENCE = 0.7
# ... and far less when it carries an e-mail address the user never wrote in this task (possible injection):
# such a memory is "unverified" and is never offered as a recipient by contact lookup.
UNGROUNDED_CONFIDENCE = 0.4
_FRESHNESS_NOTE = ("Memories can be outdated or wrong. Treat 'stale' or 'unverified' entries as hints to "
                   "confirm with the user or a tool, never as established facts.")


# ---------------------------------------------------------------------------- memory.search
class MemorySearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = Field(min_length=1, max_length=500, description="What to recall, in natural language")
    limit: int = Field(default=5, ge=1, le=10)
    memory_types: list[MemoryType] | None = Field(default=None, max_length=8)


class MemoryHit(BaseModel):
    id: str
    content: str
    memory_type: str
    subject_key: str | None = None
    confidence: float
    freshness: Freshness
    status: str
    source_type: str
    last_verified_at: str
    score: float


class MemorySearchOut(BaseModel):
    memories: list[MemoryHit]
    note: str = _FRESHNESS_NOTE


class MemorySearchTool(Tool[MemorySearchIn, MemorySearchOut]):
    input_model = MemorySearchIn
    output_model = MemorySearchOut
    spec = ToolSpec(
        name="memory.search", description="Recall relevant facts, preferences and contacts the user asked to "
                                          "remember (with freshness and confidence flags)",
        category="memory", provider="internal", permission_level=PermissionLevel.READ,
        risk_level=RiskLevel.LOW, timeout_seconds=15, output_trust=TrustLevel.CONTROLLED_AGENT_OUTPUT,
        verification_method=VerificationMethod.OUTPUT_SCHEMA,
    )

    async def execute(self, tctx: ToolContext, args: MemorySearchIn) -> ToolResult:
        async with tctx.services.session_factory() as session:
            session.info["tenant_id"] = tctx.tenant_id
            results = await service.search_memories(
                session, tenant_id=tctx.tenant_id, user_id=tctx.user_id, query=args.query, limit=args.limit,
                memory_types=[t.value for t in args.memory_types] if args.memory_types else None,
                model_router=tctx.services.model)
            await session.commit()  # access statistics
        out = MemorySearchOut(memories=[
            MemoryHit(id=str(m.id), content=m.content, memory_type=m.memory_type, subject_key=m.subject_key,
                      confidence=m.confidence, freshness=m.freshness, status=m.status,
                      source_type=m.source_type, last_verified_at=m.last_verified_at.isoformat(),
                      score=m.score)
            for m in results])
        flagged = sum(1 for m in results if m.freshness != "fresh")
        summary = f"Recalled {len(results)} memor{'y' if len(results) == 1 else 'ies'}"
        if flagged:
            summary += f" ({flagged} stale or unverified)"
        return ToolResult(output=out.model_dump(), summary=summary, trust=TrustLevel.CONTROLLED_AGENT_OUTPUT)


# ---------------------------------------------------------------------------- memory.save
class MemorySaveIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=3, max_length=1000,
                         description="One self-contained fact, e.g. 'Rahim's e-mail is rahim@example.com'")
    memory_type: Literal["preference", "long_term", "verified_fact", "contact"]
    subject_key: str | None = Field(default=None, max_length=200,
                                    description="Stable key for updates, e.g. 'contact:rahim:email', "
                                                "'pref:meeting_length'")
    importance: float = Field(default=0.6, ge=0.0, le=1.0)


class MemorySaveOut(BaseModel):
    memory_id: str
    content_hash: str
    memory_type: str
    status: str
    confidence: float


def _save_reference(tctx: ToolContext) -> str:
    return f"task:{tctx.task_id}"


def _save_out(item: Any) -> MemorySaveOut:
    return MemorySaveOut(memory_id=str(item.id), content_hash=item.content_hash, memory_type=item.memory_type,
                         status=item.status, confidence=item.confidence)


class MemorySaveTool(Tool[MemorySaveIn, MemorySaveOut]):
    input_model = MemorySaveIn
    output_model = MemorySaveOut
    spec = ToolSpec(
        name="memory.save", description="Remember a durable fact, preference or contact for future tasks",
        category="memory", provider="internal", permission_level=PermissionLevel.WRITE,
        risk_level=RiskLevel.LOW, requires_approval=False, supports_idempotency=True,
        idempotency_strategy=IdempotencyStrategy.RECONCILE_LOOKUP,
        timeout_seconds=15, retry_policy=RetryPolicy(max_attempts=3), parallel_safe=False,
        verification_method=VerificationMethod.READ_BACK, output_trust=TrustLevel.CONTROLLED_AGENT_OUTPUT,
    )

    def describe(self, args: MemorySaveIn) -> str:
        return f"Remember ({args.memory_type}): {args.content[:120]}"

    def target(self, args: MemorySaveIn) -> str | None:
        return f"memory:{args.subject_key or args.memory_type}"

    async def execute(self, tctx: ToolContext, args: MemorySaveIn) -> ToolResult:
        async with tctx.services.session_factory() as session:
            session.info["tenant_id"] = tctx.tenant_id
            confidence = TOOL_SAVE_CONFIDENCE
            emails = service.extract_emails(args.content)
            if emails:
                user_text = await service.trusted_task_text(session, task_id=tctx.task_id)
                grounded = set(service.extract_emails(user_text))
                if any(e not in grounded for e in emails):
                    confidence = UNGROUNDED_CONFIDENCE
            try:
                item = await service.create_memory(
                    session, tenant_id=tctx.tenant_id, user_id=tctx.user_id, content=args.content,
                    memory_type=args.memory_type, confidence=confidence, importance=args.importance,
                    source_type=MemorySourceType.TASK.value, source_reference=_save_reference(tctx),
                    subject_key=args.subject_key)
            except ValidationFailed as exc:
                raise ToolInputInvalid(exc.message, details=exc.details) from exc
            out = _save_out(item)
            await session.commit()
        summary = f"Saved memory ({out.memory_type})"
        if out.status == MemoryStatus.CONFLICTED.value:
            summary += " — it conflicts with an existing, more trusted memory and was stored as unconfirmed"
        elif out.confidence < 0.5:
            summary += " as unverified (contains an address the user did not provide)"
        return ToolResult(output=out.model_dump(), external_ref=out.memory_id, summary=summary)

    async def verify(self, tctx: ToolContext, args: MemorySaveIn, result: ToolResult) -> VerificationOutcome:
        expected_hash = service.memory_content_hash(args.content)
        expected = {"content_hash": expected_hash, "live": True, "attributed": True}
        try:
            memory_id = uuid.UUID(str(result.output.get("memory_id")))
        except ValueError:
            return VerificationOutcome.failed_with(
                VerificationMethod.READ_BACK,
                [Difference(field="memory_id", expected="uuid", observed="invalid")], expected=expected)
        async with tctx.services.session_factory() as session:
            session.info["tenant_id"] = tctx.tenant_id
            item = await service.get_memory(session, tenant_id=tctx.tenant_id, user_id=tctx.user_id,
                                            memory_id=memory_id)
            attributed = item is not None and await service.has_source(
                session, memory_id=memory_id, source_type=MemorySourceType.TASK.value,
                source_reference=_save_reference(tctx))
        if item is None:
            return VerificationOutcome.failed_with(
                VerificationMethod.READ_BACK,
                [Difference(field="memory", expected="exists", observed="not found")],
                expected=expected, evidence={"memory_id": str(memory_id)})
        observed = {"content_hash": item.content_hash, "live": item.status in service.LIVE_STATUSES,
                    "attributed": attributed}
        diffs = [Difference(field=k, expected=v, observed=observed[k])
                 for k, v in expected.items() if observed[k] != v]
        evidence = {"memory_id": str(item.id), "status": item.status}
        if diffs:
            return VerificationOutcome.failed_with(VerificationMethod.READ_BACK, diffs, expected=expected,
                                                   observed=observed, evidence=evidence)
        return VerificationOutcome.passed_with(VerificationMethod.READ_BACK, expected=expected,
                                               observed=observed, evidence=evidence)

    async def reconcile(self, tctx: ToolContext, args: MemorySaveIn) -> ReconcileOutcome:
        async with tctx.services.session_factory() as session:
            session.info["tenant_id"] = tctx.tenant_id
            item = await service.find_memory_by_source(
                session, tenant_id=tctx.tenant_id, user_id=tctx.user_id, content=args.content,
                source_type=MemorySourceType.TASK.value, source_reference=_save_reference(tctx))
        if item is None:
            # The write is a single local transaction: absent means it never committed; safe to retry.
            return ReconcileOutcome(status=ReconcileStatus.NOT_FOUND,
                                    evidence={"content_hash": service.memory_content_hash(args.content)})
        out = _save_out(item)
        return ReconcileOutcome(status=ReconcileStatus.FOUND, evidence={"memory_id": out.memory_id},
                                result=ToolResult(output=out.model_dump(), external_ref=out.memory_id,
                                                  summary=f"Confirmed memory ({out.memory_type}) was saved"))


TOOLS: list[Tool[Any, Any]] = [MemorySearchTool(), MemorySaveTool()]
