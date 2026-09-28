"""Alembic environment (async engine). Schema changes are applied only via migrations,
never by application startup."""

from __future__ import annotations

import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from app.core.config import get_settings
from app.core.database import Base
from app.db_models import import_all_models

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

import_all_models()
target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or get_settings().database_url


def include_object(obj, name, type_, reflected, compare_to):  # type: ignore[no-untyped-def]
    # alembic_version and extension-owned objects are not part of the ORM metadata.
    return not (type_ == "table" and reflected and compare_to is None and name == "alembic_version")


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"}, compare_type=True, include_object=include_object)
    with context.begin_transaction():
        context.run_migrations()


def _do_run(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                      include_object=include_object, transaction_per_migration=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(_url(), pool_pre_ping=True)
    async with engine.connect() as connection:
        await connection.run_sync(_do_run)
        await connection.commit()
    await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
