"""DB helpers for ACBE integration tests: failed tasks with verified failures, and candidates."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.acbe.models import StrategyCandidate, StrategyStatus
from app.core.database import system_session
from app.recovery.models import FailureRecord
from app.tasks.models import Task


class HasPrincipal(Protocol):
    user_id: uuid.UUID
    tenant_id: uuid.UUID


async def add_failed_task(user: HasPrincipal, *, fingerprint: str, source: str = "api", tool: str = "calendar.create_event",
                          error_class: str = "verification_failed", error_code: str = "verification_mismatch",
                          strategy_version: str | None = "baseline", failures: int = 1) -> tuple[uuid.UUID, list[str]]:
    async with system_session() as s:
        task = Task(tenant_id=user.tenant_id, user_id=user.user_id, goal="Schedule a meeting", status="failed",
                    source=source, budget={}, strategy_version=strategy_version)
        s.add(task)
        await s.flush()
        ids = []
        for _ in range(failures):
            record = FailureRecord(tenant_id=user.tenant_id, task_id=task.id, tool_name=tool, error_class=error_class,
                                   error_code=error_code, message="The result did not match what was requested: summary",
                                   fingerprint=fingerprint, verified=True, strategy_version=strategy_version,
                                   context_metadata={"permission_level": "write"})
            s.add(record)
            await s.flush()
            ids.append(str(record.id))
        await s.commit()
        return task.id, ids


async def add_candidate(tenant_id: uuid.UUID | None, *, config: dict[str, Any] | None = None,
                        status: str = StrategyStatus.PASSED, failure_type: str = "VERIFICATION_FAILURE",
                        fingerprint: str | None = None) -> StrategyCandidate:
    fp = fingerprint or uuid.uuid4().hex
    async with system_session() as s:
        candidate = StrategyCandidate(
            tenant_id=tenant_id, scope="tool:calendar.create_event", failure_type=failure_type,
            failure_fingerprint=fp, source_failure_ids=[], failed_strategy={"version": "baseline", "config": {}},
            candidate_config=config or {"verification_readback": {"calendar.create_event": {"attempts": 5,
                                                                                            "delay_ms": 100}}},
            rationale="test", status=status, version_label=f"acbe-{fp[:8]}-1")
        s.add(candidate)
        await s.commit()
        return candidate
