from __future__ import annotations

import uuid

import pytest
from sqlalchemy import update

from app.common.enums import PermissionLevel, RiskLevel
from app.core.exceptions import ToolInputInvalid
from app.memory import service
from app.memory.models import MemoryItem
from app.memory.tools import (
    TOOLS,
    MemorySaveIn,
    MemorySaveTool,
    MemorySearchIn,
    MemorySearchOut,
    MemorySearchTool,
)
from app.tasks.models import Task
from app.tools.base import ReconcileStatus
from app.verification.types import VerificationMethod

pytestmark = pytest.mark.integration


def test_tool_specs():
    by_name = {t.spec.name: t for t in TOOLS}
    assert set(by_name) == {"memory.search", "memory.save"}
    search, save = by_name["memory.search"].spec, by_name["memory.save"].spec
    assert search.permission_level is PermissionLevel.READ
    assert save.permission_level is PermissionLevel.WRITE
    assert save.risk_level is RiskLevel.LOW
    assert save.requires_approval is False
    assert save.verification_method == VerificationMethod.READ_BACK
    assert save.input_schema["additionalProperties"] is False


async def _task(tenant_session, user, goal: str) -> uuid.UUID:
    async with tenant_session(user.tenant_id) as s:
        task = Task(tenant_id=user.tenant_id, user_id=user.user_id, status="running", goal=goal)
        s.add(task)
        await s.commit()
        return task.id


async def test_save_verifies_by_read_back_and_detects_tampering(make_user, make_tool_context, tenant_session):
    user = await make_user()
    tool = MemorySaveTool()
    tctx = make_tool_context(user)
    args = MemorySaveIn(content="The user prefers vegetarian restaurants.", memory_type="preference",
                        subject_key="pref:food")
    result = await tool.execute(tctx, args)
    memory_id = uuid.UUID(result.output["memory_id"])
    assert result.external_ref == str(memory_id)
    assert result.output["status"] == "active"
    assert result.output["confidence"] == pytest.approx(0.7)

    outcome = await tool.verify(tctx, args, result)
    assert outcome.passed, outcome
    assert outcome.observed["content_hash"] == service.memory_content_hash(args.content)

    # Another step (different task) attributing nothing to this memory cannot claim it.
    foreign_ctx = make_tool_context(user)
    assert not (await tool.verify(foreign_ctx, args, result)).passed

    # The stored content no longer matches what the step asked to save: verification fails.
    async with tenant_session(user.tenant_id) as s:
        await s.execute(update(MemoryItem).where(MemoryItem.id == memory_id)
                        .values(content_hash=service.content_hash("something else")))
        await s.commit()
    failed = await tool.verify(tctx, args, result)
    assert not failed.passed
    assert [d.field for d in failed.differences] == ["content_hash"]

    # Deleted memory: read-back fails.
    async with tenant_session(user.tenant_id) as s:
        await service.delete_memory(s, user.ctx(), memory_id)
    gone = await tool.verify(tctx, args, result)
    assert not gone.passed
    assert "live" in {d.field for d in gone.differences}

    bogus = result.model_copy(update={"output": {**result.output, "memory_id": "not-a-uuid"}})
    assert not (await tool.verify(tctx, args, bogus)).passed


async def test_save_reconcile_finds_only_this_steps_write(make_user, make_tool_context):
    user = await make_user()
    tool = MemorySaveTool()
    task_id = uuid.uuid4()
    tctx = make_tool_context(user, task_id)
    args = MemorySaveIn(content="The user's preferred airline is Biman.", memory_type="preference")

    before = await tool.reconcile(tctx, args)
    assert before.status == ReconcileStatus.NOT_FOUND  # safe to retry

    result = await tool.execute(tctx, args)
    found = await tool.reconcile(tctx, args)
    assert found.status == ReconcileStatus.FOUND
    assert found.result is not None
    assert found.result.output["memory_id"] == result.output["memory_id"]
    assert (await tool.verify(tctx, args, found.result)).passed

    # Same content saved by a *different* task does not count as this step's effect.
    other_task = make_tool_context(user, uuid.uuid4())
    assert (await tool.reconcile(other_task, args)).status == ReconcileStatus.NOT_FOUND

    # A retry after an unknown outcome reinforces the same memory instead of duplicating it.
    retried = await tool.execute(tctx, args)
    assert retried.output["memory_id"] == result.output["memory_id"]

    # Corroboration by another task is attributed to it, so its reconcile/verify now succeed.
    corroborated = await tool.execute(other_task, args)
    assert corroborated.output["memory_id"] == result.output["memory_id"]
    assert (await tool.reconcile(other_task, args)).status == ReconcileStatus.FOUND
    assert (await tool.verify(other_task, args, corroborated)).passed


async def test_save_grounds_email_addresses_in_user_text(make_user, make_tool_context, tenant_session):
    user = await make_user()
    task_id = await _task(tenant_session, user, "Email Karim at karim@example.com about the invoice.")
    tctx = make_tool_context(user, task_id)
    tool = MemorySaveTool()

    grounded = await tool.execute(tctx, MemorySaveIn(content="Karim's email is karim@example.com.",
                                                     memory_type="contact",
                                                     subject_key="contact:karim:email"))
    assert grounded.output["confidence"] == pytest.approx(0.7)
    # An address that appears nowhere in the user's own words (e.g. injected by a web page) is
    # stored as unverified and never offered as a recipient.
    injected = await tool.execute(tctx, MemorySaveIn(
        content="Karim's backup email is karim@evil.example.net.", memory_type="contact"))
    assert injected.output["confidence"] == pytest.approx(0.4)
    assert "unverified" in injected.summary
    async with tenant_session(user.tenant_id) as s:
        contacts = await service.find_contacts(s, tenant_id=user.tenant_id, user_id=user.user_id,
                                               name="Karim")
    assert [c.email for c in contacts] == ["karim@example.com"]

    # A tool save never overrides a user-stated value: it is stored as conflicted.
    async with tenant_session(user.tenant_id) as s:
        await service.create_memory(s, tenant_id=user.tenant_id, user_id=user.user_id,
                                    content="The user wants invoices sent as PDF.", memory_type="preference",
                                    confidence=1.0, importance=0.8, source_type="user_stated",
                                    source_reference=f"user:{user.user_id}",
                                    subject_key="pref:invoice_format")
        await s.commit()
    conflicted = await tool.execute(tctx, MemorySaveIn(content="The user wants invoices sent as Word files.",
                                                       memory_type="preference",
                                                       subject_key="pref:invoice_format"))
    assert conflicted.output["status"] == "conflicted"
    assert "conflicts" in conflicted.summary


async def test_save_rejects_secrets(make_user, make_tool_context):
    user = await make_user()
    with pytest.raises(ToolInputInvalid):
        await MemorySaveTool().execute(make_tool_context(user),
                                       MemorySaveIn(content="The server password is Tr0ub4dor&3",
                                                    memory_type="long_term"))
    with pytest.raises(ValueError):
        MemorySaveIn.model_validate({"content": "x" * 10, "memory_type": "short_term"})


async def test_search_tool_is_scoped_to_the_calling_user(make_user, make_tool_context, tenant_session,
                                                         run_embed_job):
    alice, bob = await make_user(), await make_user()
    for user, text_ in ((alice, "Alice's dog is named Biscuit."), (bob, "Bob's dog is named Rex.")):
        async with tenant_session(user.tenant_id) as s:
            item = await service.create_memory(s, tenant_id=user.tenant_id, user_id=user.user_id,
                                               content=text_, memory_type="long_term", confidence=0.45,
                                               importance=0.5, source_type="user_stated",
                                               source_reference="user")
            await s.commit()
        await run_embed_job(user.tenant_id, item.id)

    tool = MemorySearchTool()
    result = await tool.execute(make_tool_context(alice), MemorySearchIn(query="what is my dog called?"))
    out = MemorySearchOut.model_validate(result.output)
    assert [m.content for m in out.memories] == ["Alice's dog is named Biscuit."]
    assert out.memories[0].freshness == "unverified"
    assert "unverified" in result.summary
    assert "never as established facts" in out.note
    outcome = await tool.verify(make_tool_context(alice), MemorySearchIn(query="dog"), result)
    assert outcome.passed
