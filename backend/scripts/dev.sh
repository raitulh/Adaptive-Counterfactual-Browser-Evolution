#!/usr/bin/env bash
# AgentOS developer tasks for environments without `make` (same commands as the Makefile).
#
#   scripts/dev.sh <command> [args...]
#   scripts/dev.sh help
#
# Variables (environment): PYTHON (python3.11), VENV (.venv), HOST, PORT, WORKER_QUEUES,
# PROFILES ("browser minio observability"), LOAD_* (see load-test), EVAL_SUITE.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PYTHON="${PYTHON:-python3.11}"
VENV="${VENV:-.venv}"
BIN="${VENV}/bin"
PY="${PY:-${BIN}/python}"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8000}"
WORKER_QUEUES="${WORKER_QUEUES:-planning,execution,memory,notifications,files,maintenance}"
COMPOSE="${COMPOSE:-docker compose}"
PROFILES="${PROFILES:-}"
LOAD_HOST="${LOAD_HOST:-http://127.0.0.1:8000}"
LOAD_USERS="${LOAD_USERS:-50}"
LOAD_SPAWN_RATE="${LOAD_SPAWN_RATE:-5}"
LOAD_DURATION="${LOAD_DURATION:-2m}"
LOAD_TAGS="${LOAD_TAGS:-}"
LOAD_CSV="${LOAD_CSV:-loadtest-results/run}"
EVAL_SUITE="${EVAL_SUITE:-core}"

compose() {
  local args=()
  for profile in ${PROFILES}; do
    args+=(--profile "${profile}")
  done
  # shellcheck disable=SC2086
  ${COMPOSE} ${args[@]+"${args[@]}"} "$@"
}

ensure_venv() {
  if [ ! -x "${PY}" ]; then
    "${PYTHON}" -m venv "${VENV}"
    "${PY}" -m pip install --upgrade pip
  fi
}

usage() {
  cat <<'EOF'
Usage: scripts/dev.sh <command> [args...]

  venv              Create the virtualenv (.venv)
  install           Install the root acbe package and the backend with dev + otlp extras
  install-browser   Install Playwright and Chromium for the browser worker
  env               Create .env from .env.example with generated secrets
  run               Run the API with auto-reload
  worker            Run a background worker (general queues)
  eval-worker       Run the dedicated evaluation/ACBE worker (evaluation queue only)
  browser-worker    Run the isolated browser worker
  scheduler         Run the scheduler
  test              Run the whole test suite (extra args go to pytest)
  test-unit         Unit tests
  test-integration  Integration tests (PostgreSQL + Redis)
  test-e2e          End-to-end task lifecycle tests
  test-security     Security tests
  lint              Ruff lint
  format            Ruff safe autofixes
  typecheck         mypy
  migrate           alembic upgrade head + sync built-in tool definitions
  migration "msg"   Autogenerate a migration
  seed              Create idempotent demo data (refuses staging/production)
  docker-up         docker compose up -d --build   (PROFILES="browser minio observability")
  docker-down       docker compose down
  docker-logs       docker compose logs -f
  load-test         Headless Locust run (LOAD_HOST, LOAD_USERS, LOAD_SPAWN_RATE, LOAD_DURATION, LOAD_TAGS, LOAD_CSV)
  openapi           Export docs/openapi.json
  eval              Run the evaluation suite (EVAL_SUITE=core)
EOF
}

cmd="${1:-help}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "${cmd}" in
  help|-h|--help) usage ;;
  venv) ensure_venv ;;
  install)
    ensure_venv
    "${PY}" -m pip install -e ..
    "${PY}" -m pip install -e ".[dev,otlp]"
    ;;
  install-browser)
    ensure_venv
    "${PY}" -m pip install -e ".[browser]"
    "${PY}" -m playwright install chromium
    echo "On a fresh Linux host also run: sudo ${PY} -m playwright install-deps chromium"
    ;;
  env)
    if [ -f .env ]; then
      echo ".env already exists; not overwriting"
      exit 0
    fi
    jwt="$("${PY}" -c 'import secrets; print(secrets.token_urlsafe(64))')"
    fernet="$("${PY}" -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"
    sed -e "s|^JWT_SECRET=\$|JWT_SECRET=${jwt}|" -e "s|^TOKEN_ENCRYPTION_KEY=\$|TOKEN_ENCRYPTION_KEY=${fernet}|" \
      .env.example > .env
    chmod 600 .env
    echo "Wrote .env (JWT_SECRET and TOKEN_ENCRYPTION_KEY generated). Set GEMINI_API_KEY / GOOGLE_* as needed."
    ;;
  run) exec "${PY}" -m uvicorn --factory app.main:app_factory --reload --host "${HOST}" --port "${PORT}" "$@" ;;
  worker) exec "${PY}" -m app.workers.worker --queues "${WORKER_QUEUES}" "$@" ;;
  eval-worker) exec "${PY}" -m app.workers.worker --queues evaluation --concurrency 1 "$@" ;;
  browser-worker) exec "${BIN}/agentos-browser-worker" "$@" ;;
  scheduler) exec "${PY}" -m app.workers.scheduler.scheduler "$@" ;;
  test) exec "${PY}" -m pytest "$@" ;;
  test-unit) exec "${PY}" -m pytest tests/unit "$@" ;;
  test-integration) exec "${PY}" -m pytest -m integration "$@" ;;
  test-e2e) exec "${PY}" -m pytest -m e2e tests/e2e "$@" ;;
  test-security) exec "${PY}" -m pytest -m security "$@" ;;
  lint) exec "${BIN}/ruff" check app tests scripts ;;
  format) exec "${BIN}/ruff" check --fix app tests scripts ;;
  typecheck) exec "${BIN}/mypy" app ;;
  migrate)
    "${PY}" -m alembic upgrade head
    exec "${PY}" -m app.cli sync-tools
    ;;
  migration)
    if [ "$#" -lt 1 ] || [ -z "$1" ]; then
      echo 'usage: scripts/dev.sh migration "describe the change"' >&2
      exit 2
    fi
    exec "${PY}" -m alembic revision --autogenerate -m "$1"
    ;;
  seed) exec "${PY}" scripts/seed.py "$@" ;;
  docker-up) compose up -d --build ;;
  docker-down) compose down ;;
  docker-logs) compose logs -f --tail=200 ;;
  load-test)
    mkdir -p "$(dirname "${LOAD_CSV}")"
    tag_args=()
    if [ -n "${LOAD_TAGS}" ]; then
      # shellcheck disable=SC2206
      tag_args=(--tags ${LOAD_TAGS})
    fi
    exec "${BIN}/locust" -f tests/load/locustfile.py --headless --host "${LOAD_HOST}" \
      -u "${LOAD_USERS}" -r "${LOAD_SPAWN_RATE}" -t "${LOAD_DURATION}" --csv "${LOAD_CSV}" --csv-full-history \
      --only-summary ${tag_args[@]+"${tag_args[@]}"}
    ;;
  openapi) exec "${PY}" scripts/export_openapi.py --output docs/openapi.json "$@" ;;
  eval) exec "${PY}" -m app.evaluation.cli run --suite "${EVAL_SUITE}" "$@" ;;
  *)
    echo "unknown command: ${cmd}" >&2
    usage >&2
    exit 2
    ;;
esac
