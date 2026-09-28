"""Tenant-aware feature flags.

Defaults live in code; rows in ``feature_flags`` override them globally
(tenant_id NULL) or per tenant, optionally with a deterministic percentage
rollout (hash of flag+tenant). Results are cached briefly in-process — flags
gate features, never authorization decisions.
"""

from __future__ import annotations

import hashlib
import time
import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.common.models import FeatureFlag
from app.core.exceptions import FeatureDisabled


class Flags:
    BROWSER_AGENT = "browser_agent_enabled"
    MCP = "mcp_enabled"
    ACBE = "acbe_enabled"
    MULTI_AGENT = "multi_agent_enabled"
    EXPERIMENTAL_MEMORY = "experimental_memory_enabled"
    WEB_SEARCH = "web_search_enabled"
    MEMORY_EXTRACTION = "memory_extraction_enabled"


DEFAULTS: dict[str, bool] = {
    Flags.BROWSER_AGENT: True,
    Flags.MCP: True,
    Flags.ACBE: True,
    Flags.MULTI_AGENT: False,
    Flags.EXPERIMENTAL_MEMORY: False,
    Flags.WEB_SEARCH: True,
    Flags.MEMORY_EXTRACTION: True,
}

_CACHE_TTL = 30.0
_cache: dict[tuple[str, uuid.UUID | None], tuple[float, bool]] = {}


def _bucket(flag: str, tenant_id: uuid.UUID | None) -> int:
    digest = hashlib.sha256(f"{flag}:{tenant_id}".encode()).digest()
    return int.from_bytes(digest[:4], "big") % 100


async def is_enabled(session: AsyncSession, flag: str, tenant_id: uuid.UUID | None) -> bool:
    key = (flag, tenant_id)
    hit = _cache.get(key)
    now = time.monotonic()
    if hit and now - hit[0] < _CACHE_TTL:
        return hit[1]
    rows = (await session.execute(
        select(FeatureFlag).where(FeatureFlag.key == flag,
                                  or_(FeatureFlag.tenant_id == tenant_id, FeatureFlag.tenant_id.is_(None))),
        execution_options={"skip_tenant_scope": True},
    )).scalars().all()
    tenant_row = next((r for r in rows if r.tenant_id is not None), None)
    global_row = next((r for r in rows if r.tenant_id is None), None)
    row = tenant_row or global_row
    if row is None:
        enabled = DEFAULTS.get(flag, False)
    else:
        enabled = row.enabled and _bucket(flag, tenant_id) < max(0, min(100, row.rollout_percentage))
    _cache[key] = (now, enabled)
    return enabled


async def require_enabled(session: AsyncSession, flag: str, tenant_id: uuid.UUID | None) -> None:
    if not await is_enabled(session, flag, tenant_id):
        raise FeatureDisabled(details={"flag": flag})


def clear_cache() -> None:
    _cache.clear()
