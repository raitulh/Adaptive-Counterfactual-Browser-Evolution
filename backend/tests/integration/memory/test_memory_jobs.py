from __future__ import annotations

import json
from datetime import timedelta

import pytest
from sqlalchemy import func, select, update

from app.common import feature_flags
from app.common.feature_flags import Flags
from app.common.models import FeatureFlag
from app.common.time import utcnow
from app.core.database import get_session_factory
from app.core.exceptions import ModelUnavailable
from app.memory import jobs, service
from app.memory.models import MemoryEmbedding, MemoryItem
from app.model_gateway.providers.scripted import ScriptedProvider, json_handler
from app.model_gateway.router import ModelRouter, set_model_router
from app.tasks.models import Task
from app.workers.jobs.registry import get_handler
from app.workers.queues.base import PermanentJobFailure, RetryJob

pytestmark = pytest.mark.integration


class _DownProvider(ScriptedProvider):
    async def embed(self, texts, *, task_type, model=None, dimensions=None):
        raise ModelUnavailable("embedding backend down")


class _WrongDimsProvider(ScriptedProvider):
    async def embed(self, texts, *, task_type, model=None, dimensions=None):
        return [[0.1] * 10 for _ in texts]


async def _memory(tenant_session, user, content: str, **kw) -> MemoryItem:
    async with tenant_session(user.tenant_id) as s:
        item = await service.create_memory(
            s, tenant_id=user.tenant_id, user_id=user.user_id, content=content,
            memory_type=kw.get("memory_type", "long_term"), confidence=0.8, importance=0.6,
            source_type="user_stated", source_reference="user", subject_key=kw.get("subject_key"))
        await s.commit()
        return item


async def _embedding_count(tenant_session, user, memory_id) -> int:
    async with tenant_session(user.tenant_id) as s:
        return int((await s.execute(select(func.count()).select_from(MemoryEmbedding)
                                    .where(MemoryEmbedding.memory_id == memory_id))).scalar_one())


def test_handlers_are_registered():
    assert get_handler("memory.embed") is jobs.embed_memory
    assert get_handler("memory.extract") is jobs.extract_memories
    assert get_handler("memory.purge_deleted") is jobs.purge_deleted


async def test_embed_job_is_idempotent_and_retries_when_model_unavailable(make_user, tenant_session,
                                                                          make_job_context, scripted_router):
    user = await make_user()
    item = await _memory(tenant_session, user, "The user keeps receipts in the blue folder.")
    payload = {"tenant_id": str(user.tenant_id), "memory_id": str(item.id)}

    set_model_router(ModelRouter(_DownProvider(), usage_sink=None))
    with pytest.raises(RetryJob):
        await jobs.embed_memory(make_job_context("memory.embed", payload, user.tenant_id), payload)
    assert await _embedding_count(tenant_session, user, item.id) == 0

    set_model_router(ModelRouter(_WrongDimsProvider(), usage_sink=None))
    with pytest.raises(PermanentJobFailure):
        await jobs.embed_memory(make_job_context("memory.embed", payload, user.tenant_id), payload)

    set_model_router(scripted_router)
    for _ in range(2):  # at-least-once delivery: running twice leaves exactly one embedding
        await jobs.embed_memory(make_job_context("memory.embed", payload, user.tenant_id), payload)
    assert await _embedding_count(tenant_session, user, item.id) == 1

    for bad in ({}, {"tenant_id": "nope", "memory_id": str(item.id)}):
        with pytest.raises(PermanentJobFailure):
            await jobs.embed_memory(make_job_context("memory.embed", bad, user.tenant_id), bad)


async def test_embed_job_skips_deleted_superseded_and_changed_memories(make_user, tenant_session,
                                                                       make_job_context, scripted_router):
    user = await make_user()
    deleted = await _memory(tenant_session, user, "Temporary fact to delete.")
    old = await _memory(tenant_session, user, "The user's manager is Nadia.", subject_key="person:manager")
    await _memory(tenant_session, user, "The user's manager is Farhan.", subject_key="person:manager")
    async with tenant_session(user.tenant_id) as s:
        await service.delete_memory(s, user.ctx(), deleted.id)

    for item in (deleted, old):
        payload = {"tenant_id": str(user.tenant_id), "memory_id": str(item.id)}
        await jobs.embed_memory(make_job_context("memory.embed", payload, user.tenant_id), payload)
        assert await _embedding_count(tenant_session, user, item.id) == 0

    # The memory changes while the embedding is being computed: the stale vector is discarded.
    changing = await _memory(tenant_session, user, "The user's locker code changes weekly.")

    class _RacingProvider(ScriptedProvider):
        async def embed(self, texts, *, task_type, model=None, dimensions=None):
            async with get_session_factory()() as s:
                s.info["tenant_id"] = user.tenant_id
                await s.execute(update(MemoryItem).where(MemoryItem.id == changing.id)
                                .values(content_hash=service.content_hash("edited meanwhile")))
                await s.commit()
            return await super().embed(texts, task_type=task_type, model=model, dimensions=dimensions)

    set_model_router(ModelRouter(_RacingProvider(), usage_sink=None))
    payload = {"tenant_id": str(user.tenant_id), "memory_id": str(changing.id)}
    await jobs.embed_memory(make_job_context("memory.embed", payload, user.tenant_id), payload)
    assert await _embedding_count(tenant_session, user, changing.id) == 0

    # Wrong tenant in the payload: the tenant-scoped session cannot see the memory at all.
    other = await make_user()
    forged = {"tenant_id": str(other.tenant_id), "memory_id": str(changing.id)}
    set_model_router(scripted_router)
    await jobs.embed_memory(make_job_context("memory.embed", forged, other.tenant_id), forged)
    assert await _embedding_count(tenant_session, user, changing.id) == 0


async def _finished_task(tenant_session, user) -> Task:
    async with tenant_session(user.tenant_id) as s:
        task = Task(tenant_id=user.tenant_id, user_id=user.user_id, status="completed",
                    goal="Book a table for two; I am vegetarian.")
        s.add(task)
        await s.commit()
        return task


async def test_extract_job_stores_retries_and_respects_flag(make_user, tenant_session, make_job_context,
                                                            db_session, scripted_router):
    # ``scripted_router`` restores a sane process-wide router on teardown after the swaps below.
    user = await make_user()
    task = await _finished_task(tenant_session, user)
    payload = {"tenant_id": str(user.tenant_id), "task_id": str(task.id)}
    ctx = make_job_context("memory.extract", payload, user.tenant_id)

    set_model_router(ModelRouter(ScriptedProvider(lambda r: ModelUnavailable("down")), usage_sink=None))
    with pytest.raises(RetryJob):
        await jobs.extract_memories(ctx, payload)

    invalid = ScriptedProvider(lambda r: "definitely not json")
    set_model_router(ModelRouter(invalid, usage_sink=None))
    await jobs.extract_memories(ctx, payload)  # invalid model output: logged and skipped, never raised
    assert len(invalid.calls) == 3  # initial attempt + bounded repairs

    good = ScriptedProvider(json_handler({"memory_extraction": json.dumps({"memories": [
        {"content": "The user is vegetarian.", "memory_type": "preference", "subject_key": "pref:diet",
         "importance": 0.9, "confidence": 0.95}]})}))
    set_model_router(ModelRouter(good, usage_sink=None))
    await jobs.extract_memories(ctx, payload)
    await jobs.extract_memories(ctx, payload)  # duplicate delivery: no second model call
    assert len(good.calls) == 1
    async with tenant_session(user.tenant_id) as s:
        rows = (await s.execute(select(MemoryItem).where(MemoryItem.user_id == user.user_id))).scalars().all()
    assert [(r.content, r.source_type, r.source_reference) for r in rows] == [
        ("The user is vegetarian.", "extraction", f"task:{task.id}")]

    # Tenant opted out of extraction: the job does nothing.
    disabled_user = await make_user()
    disabled_task = await _finished_task(tenant_session, disabled_user)
    db_session.add(FeatureFlag(key=Flags.MEMORY_EXTRACTION, tenant_id=disabled_user.tenant_id, enabled=False))
    await db_session.commit()
    feature_flags.clear_cache()
    disabled_payload = {"tenant_id": str(disabled_user.tenant_id), "task_id": str(disabled_task.id)}
    await jobs.extract_memories(make_job_context("memory.extract", disabled_payload, disabled_user.tenant_id),
                                disabled_payload)
    assert len(good.calls) == 1


async def test_purge_job_uses_retention_setting(make_user, tenant_session, make_job_context, db_session):
    user = await make_user()
    old = await _memory(tenant_session, user, "Old deleted memory.")
    recent = await _memory(tenant_session, user, "Recently deleted memory.")
    async with tenant_session(user.tenant_id) as s:
        await service.delete_memory(s, user.ctx(), old.id)
        await service.delete_memory(s, user.ctx(), recent.id)
        await s.execute(update(MemoryItem).where(MemoryItem.id == old.id)
                        .values(deleted_at=utcnow() - timedelta(days=31)))
        await s.execute(update(MemoryItem).where(MemoryItem.id == recent.id)
                        .values(deleted_at=utcnow() - timedelta(days=29)))
        await s.commit()

    await jobs.purge_deleted(make_job_context("memory.purge_deleted", {"bucket": 1}, None), {"bucket": 1})
    assert await db_session.get(MemoryItem, old.id) is None
    assert await db_session.get(MemoryItem, recent.id) is not None
