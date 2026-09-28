"""The job handlers are registered and run end-to-end the way a worker invokes them."""

from __future__ import annotations

import uuid
from typing import Any

import pytest

import app.automations.jobs
import app.workers.jobs.maintenance  # noqa: F401  (registers handlers)
from app.core.database import get_session_factory
from app.workers.jobs.registry import JobContext, get_handler
from app.workers.queues.base import ClaimedJob, PermanentJobFailure

pytestmark = pytest.mark.integration

JOB_TYPES = ("maintenance.expire_approvals", "maintenance.aggregate_usage", "maintenance.recover_stalled_tasks",
             "maintenance.retention", "maintenance.cleanup_jobs", "account.purge", "automation.sync_runs")


def _ctx(job_type: str, payload: dict[str, Any]) -> JobContext:
    job = ClaimedJob(id=uuid.uuid4(), queue="maintenance", job_type=job_type, payload=payload, attempts=1,
                     max_attempts=3, tenant_id=None)
    return JobContext(job=job, worker_id="test-worker", session_factory=get_session_factory())


@pytest.mark.parametrize("job_type", JOB_TYPES)
def test_handlers_are_registered(job_type: str) -> None:
    assert get_handler(job_type) is not None


@pytest.mark.parametrize("job_type", [t for t in JOB_TYPES if t != "account.purge"])
async def test_periodic_handlers_run_cleanly(job_type: str, audit_append_only) -> None:
    handler = get_handler(job_type)
    assert handler is not None
    payload = {"bucket": 1}
    await handler(_ctx(job_type, payload), payload)
    await handler(_ctx(job_type, payload), payload)  # idempotent


async def test_account_purge_rejects_malformed_payload() -> None:
    handler = get_handler("account.purge")
    assert handler is not None
    with pytest.raises(PermanentJobFailure):
        await handler(_ctx("account.purge", {"user_id": "not-a-uuid"}), {"user_id": "not-a-uuid"})
    await handler(_ctx("account.purge", {"user_id": str(uuid.uuid4())}), {"user_id": str(uuid.uuid4())})
