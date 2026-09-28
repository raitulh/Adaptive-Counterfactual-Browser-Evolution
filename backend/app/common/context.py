"""Request/actor context derived *only* from authenticated server-side state.

Client-supplied tenant/user identifiers are never trusted: handlers receive a
``RequestContext`` built from the verified access token + DB session row +
membership lookup.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from app.core.exceptions import Forbidden


@dataclass(frozen=True, slots=True)
class RequestContext:
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role: str
    permissions: frozenset[str]
    session_id: uuid.UUID | None = None
    is_platform_admin: bool = False
    request_id: str | None = None
    ip: str | None = None
    user_agent: str | None = None
    timezone: str = "UTC"
    email: str | None = None
    actor_type: str = "user"
    extra: dict[str, str] = field(default_factory=dict)

    @property
    def organization_id(self) -> uuid.UUID:
        # In the current deployment model a tenant *is* an organization.
        return self.tenant_id

    def has(self, permission: str) -> bool:
        return permission in self.permissions

    def require(self, *permissions: str) -> None:
        missing = [p for p in permissions if p not in self.permissions]
        if missing:
            raise Forbidden(details={"missing_permissions": missing})


def system_context(tenant_id: uuid.UUID, user_id: uuid.UUID, *, role: str = "member",
                   permissions: frozenset[str] | None = None, timezone: str = "UTC",
                   actor_type: str = "worker") -> RequestContext:
    """Context for background execution on behalf of a user. Permissions are re-derived
    from the user's *current* membership by the caller before use."""
    return RequestContext(user_id=user_id, tenant_id=tenant_id, role=role,
                          permissions=permissions or frozenset(), timezone=timezone, actor_type=actor_type)
