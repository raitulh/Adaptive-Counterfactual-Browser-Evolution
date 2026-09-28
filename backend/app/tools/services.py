"""Dependency container handed to tools. Built once per process; tests swap parts
(e.g. an httpx transport that fakes Google) without touching tool code."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

import httpx
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.integrations.google.adapters import (
    CalendarAdapter,
    DriveAdapter,
    GmailAdapter,
    GoogleApiClient,
    PeopleAdapter,
)
from app.integrations.vault import CredentialVault
from app.model_gateway.router import ModelRouter

if TYPE_CHECKING:
    from app.files.storage import ObjectStorage
    from app.search.providers import SearchProvider
    from app.tools.base import ToolContext


@dataclass(slots=True)
class GoogleClients:
    calendar: CalendarAdapter
    gmail: GmailAdapter
    drive: DriveAdapter
    people: PeopleAdapter
    account_email: str | None = None


@dataclass
class ToolServices:
    session_factory: async_sessionmaker[AsyncSession]
    vault: CredentialVault
    model: ModelRouter
    google_http: httpx.AsyncClient
    storage: ObjectStorage
    search: SearchProvider | None
    settings: Settings = field(default_factory=get_settings)
    extras: dict[str, Any] = field(default_factory=dict)

    async def google(self, tctx: ToolContext, scopes: list[str]) -> GoogleClients:
        grant = await self.vault.get_google_access(tctx.tenant_id, tctx.user_id, scopes)
        state = {"token": grant.access_token}

        async def token_provider(force: bool) -> str:
            if force:
                fresh = await self.vault.get_google_access(tctx.tenant_id, tctx.user_id, scopes, force_refresh=True)
                state["token"] = fresh.access_token
            return state["token"]

        client = GoogleApiClient(token_provider, self.google_http, timeout=self.settings.google_api_timeout_seconds)
        return GoogleClients(CalendarAdapter(client), GmailAdapter(client), DriveAdapter(client),
                             PeopleAdapter(client), account_email=grant.account_email)


_services: ToolServices | None = None


def build_tool_services(settings: Settings | None = None) -> ToolServices:
    from app.core.database import get_session_factory
    from app.core.redis import get_redis
    from app.files.storage import build_storage
    from app.integrations.google.oauth import GoogleOAuthClient
    from app.model_gateway.router import get_model_router
    from app.search.providers import build_search_provider

    settings = settings or get_settings()
    sf = get_session_factory()
    http = httpx.AsyncClient(timeout=settings.google_api_timeout_seconds)
    return ToolServices(
        session_factory=sf,
        vault=CredentialVault(sf, google_oauth=GoogleOAuthClient(settings, http=http), redis=get_redis()),
        model=get_model_router(),
        google_http=http,
        storage=build_storage(settings),
        search=build_search_provider(settings),
        settings=settings,
    )


def get_tool_services() -> ToolServices:
    global _services
    if _services is None:
        _services = build_tool_services()
    return _services


def set_tool_services(services: ToolServices | None) -> None:
    global _services
    _services = services
