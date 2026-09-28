"""Versioned API router. Each domain module owns its router; this only composes them."""

from __future__ import annotations

import importlib

from fastapi import APIRouter, Depends

from app.api.dependencies import ip_rate_limit

# (module, attribute) — every public module router mounted under /api/v1.
ROUTERS: tuple[tuple[str, str], ...] = (
    ("app.auth.router", "router"),
    ("app.users.router", "router"),
    ("app.organizations.router", "router"),
    ("app.agents.router", "router"),
    ("app.tasks.router", "router"),
    ("app.tasks.router", "events_router"),
    ("app.approvals.router", "router"),
    ("app.tools.router", "router"),
    ("app.integrations.router", "router"),
    ("app.notifications.router", "router"),
    ("app.audit.router", "router"),
    ("app.usage.router", "router"),
    ("app.billing.router", "router"),
    ("app.admin.router", "router"),
    ("app.memory.router", "router"),
    ("app.automations.router", "router"),
    ("app.files.router", "router"),
    ("app.search.router", "router"),
    ("app.mcp.router", "router"),
    ("app.integrations.webhook_router", "router"),
)


def build_api_router(extra: tuple[tuple[str, str], ...] = ()) -> APIRouter:
    from app.api import health

    api = APIRouter()
    api.include_router(health.router)
    guarded = APIRouter(dependencies=[Depends(ip_rate_limit)])
    for module_name, attr in (*ROUTERS, *extra):
        guarded.include_router(getattr(importlib.import_module(module_name), attr))
    api.include_router(guarded)
    return api
