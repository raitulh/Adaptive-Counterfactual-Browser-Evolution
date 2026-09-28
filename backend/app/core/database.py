"""Database engine, declarative base, shared mixins and tenant-scope enforcement.

Tenant isolation is enforced at the ORM layer, not left to each query:

* Every tenant-owned model inherits ``TenantScopedMixin``.
* A session is either *tenant scoped* (``session.info["tenant_id"]``) or an
  explicit *system* session (``session.info["system"] = True``).
* ``do_orm_execute`` injects ``tenant_id = :scope`` into every ORM SELECT /
  UPDATE / DELETE touching a tenant-scoped entity, and raises
  ``TenantScopeError`` if such a statement runs on a session with neither
  scope. Forgetting a WHERE clause therefore cannot leak another tenant's rows.
* ``before_flush`` rejects writes of tenant-scoped objects whose ``tenant_id``
  differs from the session's scope.
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import AsyncIterator, Iterator
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, MetaData, event, func, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import (
    DeclarativeBase,
    Mapped,
    ORMExecuteState,
    Session,
    declared_attr,
    mapped_column,
    with_loader_criteria,
)

from app.common.ids import new_id
from app.core.config import Settings, get_settings
from app.core.exceptions import TenantScopeError

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        uuid.UUID: PG_UUID(as_uuid=True),
        datetime: DateTime(timezone=True),
    }


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_id)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False, index=False)
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), nullable=False
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(default=None, nullable=True)


class VersionedMixin:
    """Optimistic concurrency: concurrent stale writes raise StaleDataError (-> 409)."""

    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default=text("1"))

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:  # noqa: N805
        return {"version_id_col": cls.version}  # type: ignore[attr-defined]


class TenantScopedMixin:
    """Row belongs to exactly one tenant (organization). Enforced automatically."""

    @declared_attr
    def tenant_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(
            ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
        )


class BigIntPKMixin:
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)


# ---------------------------------------------------------------------------- engine
_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def build_engine(settings: Settings) -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        echo=settings.database_echo,
        pool_size=settings.database_pool_size,
        max_overflow=settings.database_max_overflow,
        pool_timeout=settings.database_pool_timeout_seconds,
        pool_pre_ping=True,
        pool_recycle=1800,
        connect_args={
            "timeout": settings.database_connect_timeout_seconds,
            "command_timeout": settings.database_statement_timeout_ms / 1000 + 5,
            "server_settings": {
                "statement_timeout": str(settings.database_statement_timeout_ms),
                "idle_in_transaction_session_timeout": "60000",
                "application_name": settings.app_name.lower(),
            },
        },
    )


def get_engine() -> AsyncEngine:
    global _engine, _session_factory
    if _engine is None:
        _engine = build_engine(get_settings())
        _session_factory = async_sessionmaker(_engine, expire_on_commit=False, autoflush=False)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    get_engine()
    assert _session_factory is not None
    return _session_factory


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


def set_tenant_scope(session: AsyncSession | Session, tenant_id: uuid.UUID) -> None:
    session.info["tenant_id"] = tenant_id
    session.info.pop("system", None)


def set_system_scope(session: AsyncSession | Session) -> None:
    session.info["system"] = True
    session.info.pop("tenant_id", None)


@contextlib.contextmanager
def elevated_system_scope(session: AsyncSession | Session) -> Iterator[None]:
    """Temporarily switch a session to system scope for a reviewed cross-tenant write
    (e.g. creating a new organization and its first membership), then restore."""
    saved = {k: session.info.get(k) for k in ("tenant_id", "system")}
    set_system_scope(session)
    try:
        yield
    finally:
        session.info.pop("system", None)
        for key, value in saved.items():
            if value is not None:
                session.info[key] = value


@contextlib.asynccontextmanager
async def tenant_session(tenant_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    async with get_session_factory()() as session:
        set_tenant_scope(session, tenant_id)
        yield session


@contextlib.asynccontextmanager
async def system_session() -> AsyncIterator[AsyncSession]:
    """Session for trusted system code that legitimately spans tenants (workers, scheduler)."""
    async with get_session_factory()() as session:
        set_system_scope(session)
        yield session


# ---------------------------------------------------------------------------- tenant guard
def _touches_tenant_scoped(state: ORMExecuteState) -> bool:
    try:
        mappers = state.all_mappers
    except Exception:  # pragma: no cover - defensive; non-ORM statements
        return False
    return any(issubclass(m.class_, TenantScopedMixin) for m in mappers)


@event.listens_for(Session, "do_orm_execute")
def _enforce_tenant_scope(state: ORMExecuteState) -> None:
    if not (state.is_select or state.is_update or state.is_delete):
        return
    if state.execution_options.get("skip_tenant_scope") or state.is_column_load or state.is_relationship_load:
        return
    info = state.session.info
    tenant_id = info.get("tenant_id")
    if tenant_id is None:
        if info.get("system"):
            return
        if _touches_tenant_scoped(state):
            raise TenantScopeError(
                "Tenant-scoped query executed without a tenant or system scope",
                details={"statement": str(type(state.statement).__name__)},
            )
        return
    state.statement = state.statement.options(
        with_loader_criteria(
            TenantScopedMixin,
            lambda cls: cls.tenant_id == tenant_id,
            include_aliases=True,
        )
    )


@event.listens_for(Session, "before_flush")
def _enforce_tenant_on_write(session: Session, flush_context: Any, instances: Any) -> None:
    tenant_id = session.info.get("tenant_id")
    for obj in list(session.new) + list(session.dirty):
        if not isinstance(obj, TenantScopedMixin):
            continue
        obj_tenant = obj.tenant_id
        if obj_tenant is None:
            if tenant_id is None:
                raise TenantScopeError("Tenant-scoped object written without tenant_id")
            obj.tenant_id = tenant_id
        elif tenant_id is not None and obj_tenant != tenant_id:
            raise TenantScopeError("Attempted to write an object belonging to another tenant")
        elif tenant_id is None and not session.info.get("system"):
            raise TenantScopeError("Tenant-scoped object written outside a tenant/system scope")


async def check_database() -> bool:
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("SELECT 1"))
    return True
