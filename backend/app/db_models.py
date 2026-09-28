"""Imports every ORM model module so ``Base.metadata`` is complete (Alembic, tests)."""

from __future__ import annotations

import importlib

MODEL_MODULES = (
    "app.common.models",
    "app.workers.queues.models",
    "app.users.models",
    "app.auth.models",
    "app.organizations.models",
    "app.audit.models",
    "app.agents.models",
    "app.tasks.models",
    "app.verification.models",
    "app.approvals.models",
    "app.recovery.models",
    "app.tools.models",
    "app.integrations.models",
    "app.notifications.models",
    "app.usage.models",
    "app.billing.models",
    "app.memory.models",
    "app.files.models",
    "app.search.models",
    "app.mcp.models",
    "app.browser.models",
    "app.automations.models",
    "app.acbe.models",
    "app.evaluation.models",
)


def import_all_models() -> None:
    for name in MODEL_MODULES:
        importlib.import_module(name)
