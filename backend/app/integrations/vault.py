"""Credential vault: the only code path that decrypts provider tokens.

Never holds a DB transaction open across the network: read state (tx 1) →
refresh at the provider (no tx) → persist outcome (tx 2). Concurrent refreshes
of the same connection are de-duplicated with a short Redis lock.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.common.time import ensure_aware, utcnow
from app.core.crypto import KeyManager, get_key_manager
from app.core.exceptions import (
    InsufficientScope,
    IntegrationError,
    IntegrationExpired,
    IntegrationNotConnected,
    IntegrationRevoked,
    IntegrationUnavailable,
)
from app.core.redis import LockNotAcquired, short_lock
from app.integrations.google.oauth import GoogleOAuthClient, missing_scopes
from app.integrations.models import ConnectionStatus, OAuthConnection, OAuthScope

logger = logging.getLogger(__name__)
_REFRESH_MARGIN = timedelta(seconds=90)


@dataclass(slots=True)
class AccessGrant:
    access_token: str
    connection_id: uuid.UUID
    account_email: str | None
    scopes: frozenset[str]


class CredentialVault:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession], *, key_manager: KeyManager | None = None,
                 google_oauth: GoogleOAuthClient | None = None, redis: object | None = None) -> None:
        self._sf = session_factory
        self._km = key_manager or get_key_manager()
        self._google = google_oauth or GoogleOAuthClient()
        self._redis = redis

    async def _load(self, tenant_id: uuid.UUID, user_id: uuid.UUID, provider: str
                    ) -> tuple[OAuthConnection, frozenset[str]] | None:
        async with self._sf() as session:
            session.info["tenant_id"] = tenant_id
            conn = (await session.execute(
                select(OAuthConnection).where(
                    OAuthConnection.user_id == user_id, OAuthConnection.provider == provider,
                    OAuthConnection.status != ConnectionStatus.DISCONNECTED,
                ).order_by(OAuthConnection.connected_at.desc()).limit(1)
            )).scalar_one_or_none()
            if conn is None:
                return None
            scopes = frozenset((await session.execute(
                select(OAuthScope.scope).where(OAuthScope.connection_id == conn.id))).scalars().all())
            session.expunge(conn)
            return conn, scopes

    async def get_google_access(self, tenant_id: uuid.UUID, user_id: uuid.UUID, required_scopes: list[str], *,
                                force_refresh: bool = False) -> AccessGrant:
        loaded = await self._load(tenant_id, user_id, "google")
        if loaded is None:
            raise IntegrationNotConnected("Google account is not connected", provider="google")
        conn, scopes = loaded
        if conn.status == ConnectionStatus.REVOKED:
            raise IntegrationRevoked(provider="google", details={"connection_id": str(conn.id)})
        if conn.status == ConnectionStatus.EXPIRED:
            raise IntegrationExpired(provider="google", details={"connection_id": str(conn.id)})
        missing = missing_scopes(set(scopes), required_scopes)
        if missing:
            raise InsufficientScope(provider="google",
                                    details={"missing_scopes": missing, "connection_id": str(conn.id)})
        fresh = (conn.access_token_enc and conn.token_expires_at
                 and ensure_aware(conn.token_expires_at) - _REFRESH_MARGIN > utcnow())
        if fresh and not force_refresh:
            assert conn.access_token_enc is not None
            return AccessGrant(self._km.decrypt(conn.access_token_enc), conn.id, conn.account_email, scopes)
        return await self._refresh(tenant_id, conn, scopes, previous_expiry=conn.token_expires_at)

    async def _refresh(self, tenant_id: uuid.UUID, conn: OAuthConnection, scopes: frozenset[str], *,
                       previous_expiry: object) -> AccessGrant:
        if not conn.refresh_token_enc:
            await self._mark(tenant_id, conn.id, ConnectionStatus.EXPIRED, "no_refresh_token")
            raise IntegrationExpired(provider="google")
        try:
            async with short_lock(f"oauth_refresh:{conn.id}", ttl_seconds=30, redis=self._redis):  # type: ignore[arg-type]
                reloaded = await self._load(tenant_id, conn.user_id, conn.provider)
                if reloaded is not None:
                    current, scopes = reloaded
                    if current.token_expires_at != previous_expiry and current.access_token_enc and \
                            current.token_expires_at and ensure_aware(current.token_expires_at) - _REFRESH_MARGIN \
                            > utcnow():
                        return AccessGrant(self._km.decrypt(current.access_token_enc), current.id,
                                           current.account_email, scopes)
                refresh_token = self._km.decrypt(conn.refresh_token_enc)
                try:
                    tokens = await self._google.refresh(refresh_token)
                except IntegrationRevoked as exc:
                    await self._mark(tenant_id, conn.id, ConnectionStatus.EXPIRED, "invalid_grant")
                    raise IntegrationExpired("Google authorization expired or was revoked; reconnect required",
                                             provider="google") from exc
                except IntegrationError as exc:
                    await self._note_error(tenant_id, conn.id, exc.code)
                    raise IntegrationUnavailable(provider="google") from exc
                await self._store_refresh(tenant_id, conn.id, tokens.access_token, tokens.expires_in,
                                          tokens.refresh_token, tokens.scope)
                new_scopes = frozenset(tokens.scope) if tokens.scope else scopes
                return AccessGrant(tokens.access_token, conn.id, conn.account_email, new_scopes)
        except LockNotAcquired:
            # Another worker is refreshing this connection: wait for its result.
            for _ in range(20):
                await asyncio.sleep(0.25)
                reloaded = await self._load(tenant_id, conn.user_id, conn.provider)
                if reloaded is None:
                    break
                current, scopes = reloaded
                if current.access_token_enc and current.token_expires_at and \
                        ensure_aware(current.token_expires_at) - _REFRESH_MARGIN > utcnow():
                    return AccessGrant(self._km.decrypt(current.access_token_enc), current.id,
                                       current.account_email, scopes)
            raise IntegrationUnavailable("Token refresh in progress; retry shortly", provider="google") from None

    async def _store_refresh(self, tenant_id: uuid.UUID, connection_id: uuid.UUID, access_token: str,
                             expires_in: int, refresh_token: str | None, scope: set[str]) -> None:
        async with self._sf() as session:
            session.info["tenant_id"] = tenant_id
            conn = await session.get(OAuthConnection, connection_id, with_for_update=True)
            if conn is None:
                return
            conn.access_token_enc = self._km.encrypt(access_token)
            conn.token_expires_at = utcnow() + timedelta(seconds=expires_in)
            conn.last_refreshed_at = utcnow()
            if refresh_token:  # Google may rotate refresh tokens
                conn.refresh_token_enc = self._km.encrypt(refresh_token)
            if conn.status in (ConnectionStatus.TEMPORARILY_UNAVAILABLE, ConnectionStatus.INSUFFICIENT_SCOPE):
                conn.status = ConnectionStatus.CONNECTED
            if scope:
                await session.execute(delete(OAuthScope).where(OAuthScope.connection_id == connection_id))
                for s in sorted(scope):
                    session.add(OAuthScope(tenant_id=tenant_id, connection_id=connection_id, scope=s))
            await session.commit()

    async def _mark(self, tenant_id: uuid.UUID, connection_id: uuid.UUID, status: str, code: str) -> None:
        async with self._sf() as session:
            session.info["tenant_id"] = tenant_id
            conn = await session.get(OAuthConnection, connection_id, with_for_update=True)
            if conn is None:
                return
            conn.status = status
            conn.last_error_code = code
            conn.last_error_at = utcnow()
            conn.access_token_enc = None
            await session.commit()
        await _notify_connection_problem(self._sf, tenant_id, connection_id, status)

    async def _note_error(self, tenant_id: uuid.UUID, connection_id: uuid.UUID, code: str) -> None:
        async with self._sf() as session:
            session.info["tenant_id"] = tenant_id
            conn = await session.get(OAuthConnection, connection_id, with_for_update=True)
            if conn is not None:
                conn.last_error_code = code
                conn.last_error_at = utcnow()
                await session.commit()


async def _notify_connection_problem(sf: async_sessionmaker[AsyncSession], tenant_id: uuid.UUID,
                                     connection_id: uuid.UUID, status: str) -> None:
    from app.notifications.service import NotificationEvent, notify

    async with sf() as session:
        session.info["tenant_id"] = tenant_id
        conn = await session.get(OAuthConnection, connection_id)
        if conn is None:
            return
        await notify(session, tenant_id=tenant_id, user_id=conn.user_id, event=NotificationEvent.CONNECTION_EXPIRED,
                     title="Reconnect your Google account",
                     body=f"Your Google connection ({conn.account_email or 'account'}) is {status}. "
                          "Reconnect it to let tasks use Gmail, Calendar and Drive.",
                     data={"connection_id": str(conn.id), "status": status},
                     idempotency_key=f"conn:{conn.id}:{status}:{utcnow():%Y%m%d}")
        await session.commit()
