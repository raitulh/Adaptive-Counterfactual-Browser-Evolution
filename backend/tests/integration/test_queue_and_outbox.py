from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, update

from app.common.events import InMemoryEventBus
from app.common.models import OutboxEvent
from app.common.outbox import OutboxRelay, add_outbox_event
from app.core.database import get_session_factory
from app.workers.queues.base import JobSpec
from app.workers.queues.models import Job
from app.workers.queues.postgres import PostgresJobQueue

pytestmark = pytest.mark.integration


@pytest.fixture
def queue() -> PostgresJobQueue:
    return PostgresJobQueue(get_session_factory(), lease_seconds=30, default_max_attempts=2)


async def _enqueue(queue: PostgresJobQueue, spec: JobSpec) -> None:
    async with get_session_factory()() as s:
        s.info["system"] = True
        await queue.enqueue(s, spec)
        await s.commit()


async def test_transactional_enqueue_rolls_back_with_state(queue):
    qname = f"q-{uuid.uuid4().hex[:6]}"
    async with get_session_factory()() as s:
        s.info["system"] = True
        await queue.enqueue(s, JobSpec(queue=qname, job_type="x"))
        await s.rollback()
    assert await queue.claim([qname], 10, "w1") == []


async def test_dedupe_coalesces_pending_jobs_and_pulls_forward(queue):
    qname = f"q-{uuid.uuid4().hex[:6]}"
    await _enqueue(queue, JobSpec(queue=qname, job_type="x", dedupe_key="k", delay_seconds=600))
    await _enqueue(queue, JobSpec(queue=qname, job_type="x", dedupe_key="k"))
    claimed = await queue.claim([qname], 10, "w1")
    assert len(claimed) == 1, "duplicates coalesce and the sooner run_at wins"


async def test_claims_are_exclusive_and_leases_recover_after_crash(queue):
    qname = f"q-{uuid.uuid4().hex[:6]}"
    await _enqueue(queue, JobSpec(queue=qname, job_type="x"))
    first = await queue.claim([qname], 10, "worker-a")
    assert len(first) == 1 and await queue.claim([qname], 10, "worker-b") == []
    async with get_session_factory()() as s:  # worker-a dies: its lease expires
        s.info["system"] = True
        await s.execute(update(Job).where(Job.id == first[0].id).values(locked_until=Job.created_at))
        await s.commit()
    assert await queue.recover_expired_leases() >= 1
    second = await queue.claim([qname], 10, "worker-b")
    assert [j.id for j in second] == [first[0].id] and second[0].attempts == 2
    await queue.complete(second[0].id, "worker-a")  # stale owner cannot complete it
    async with get_session_factory()() as s:
        s.info["system"] = True
        assert (await s.get(Job, second[0].id)).status == "running"


async def test_retry_then_dead_letter(queue):
    qname = f"q-{uuid.uuid4().hex[:6]}"
    await _enqueue(queue, JobSpec(queue=qname, job_type="x", max_attempts=2))
    job = (await queue.claim([qname], 1, "w"))[0]
    assert await queue.fail(job.id, "w", "boom", retry_in=0) == "retry"
    job = (await queue.claim([qname], 1, "w"))[0]
    assert await queue.fail(job.id, "w", "boom again", retry_in=0) == "dead"
    async with get_session_factory()() as s:
        s.info["system"] = True
        row = await s.get(Job, job.id)
        assert row.status == "dead" and "boom again" in row.last_error


async def test_deferred_job_does_not_consume_attempts(queue):
    qname = f"q-{uuid.uuid4().hex[:6]}"
    await _enqueue(queue, JobSpec(queue=qname, job_type="x"))
    job = (await queue.claim([qname], 1, "w"))[0]
    await queue.release(job.id, "w", delay_seconds=0)
    again = (await queue.claim([qname], 1, "w"))[0]
    assert again.attempts == 1


async def test_outbox_relay_publishes_committed_events_once():
    bus = InMemoryEventBus()
    topic = f"topic-{uuid.uuid4().hex[:6]}"
    async with get_session_factory()() as s:
        s.info["system"] = True
        add_outbox_event(s, topic=topic, event_type="E", payload={"n": 1})
        await s.commit()
    async with get_session_factory()() as s:
        s.info["system"] = True
        add_outbox_event(s, topic=topic, event_type="E", payload={"n": 2})
        await s.rollback()  # never published
    relay = OutboxRelay(get_session_factory(), bus)
    while await relay.run_once():
        pass
    mine = [m for t, m in bus.published if t == topic]
    assert mine == [{"type": "E", "n": 1}]
    async with get_session_factory()() as s:
        s.info["system"] = True
        rows = (await s.execute(select(OutboxEvent).where(OutboxEvent.topic == topic))).scalars().all()
        assert all(r.published_at is not None for r in rows)
