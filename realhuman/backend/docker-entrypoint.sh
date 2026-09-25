#!/bin/sh
set -e

# Apply database migrations before serving (idempotent).
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  alembic upgrade head
fi

exec "$@"
