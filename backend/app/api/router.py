"""Versioned API router. Each domain module owns its router; this only composes them."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.dependencies import ip_rate_limit


def build_api_router() -> APIRouter:
    from app.api import health
    from app.auth.router import router as auth_router
    from app.organizations.router import router as org_router
    from app.users.router import router as users_router

    api = APIRouter()
    api.include_router(health.router)
    guarded = APIRouter(dependencies=[Depends(ip_rate_limit)])
    for router in (auth_router, users_router, org_router):
        guarded.include_router(router)
    api.include_router(guarded)
    return api
