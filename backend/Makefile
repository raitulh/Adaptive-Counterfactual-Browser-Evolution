# AgentOS backend developer tasks.  `make help` lists them.
# Without make, use scripts/dev.sh (same commands).
#
# Everything runs from this directory with the project virtualenv (.venv).
# Override any variable on the command line, e.g. `make run PORT=9000`.

SHELL := /bin/bash
.DEFAULT_GOAL := help

PYTHON      ?= python3.11
VENV        ?= .venv
BIN         := $(VENV)/bin
PY          ?= $(BIN)/python
PIP         := $(PY) -m pip

HOST        ?= 127.0.0.1
PORT        ?= 8000
WORKER_QUEUES ?= planning,execution,memory,notifications,files,maintenance,evaluation
PROFILES    ?=
COMPOSE     ?= docker compose
COMPOSE_PROFILES_ARGS := $(foreach p,$(PROFILES),--profile $(p))

# Load test defaults (tests/load/README.md explains the staged profiles).
LOAD_HOST       ?= http://127.0.0.1:8000
LOAD_USERS      ?= 50
LOAD_SPAWN_RATE ?= 5
LOAD_DURATION   ?= 2m
LOAD_TAGS       ?=
LOAD_CSV        ?= loadtest-results/run
LOAD_TAG_ARGS   := $(if $(strip $(LOAD_TAGS)),--tags $(LOAD_TAGS),)

EVAL_SUITE  ?= core

.PHONY: help venv install install-browser env run worker browser-worker scheduler \
        test test-unit test-integration test-e2e test-security lint format typecheck \
        migrate migration seed docker-up docker-down docker-logs load-test openapi eval

help: ## Show this help
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

$(PY):
	$(PYTHON) -m venv $(VENV)
	$(PIP) install --upgrade pip

venv: $(PY) ## Create the virtualenv (.venv) with python3.11 (override PYTHON=...)

install: $(PY) ## Install the root acbe package and the backend with dev + otlp extras (editable)
	$(PIP) install -e ..
	$(PIP) install -e ".[dev,otlp]"

install-browser: $(PY) ## Install Playwright and Chromium for the browser worker
	$(PIP) install -e ".[browser]"
	$(PY) -m playwright install chromium
	@echo "On a fresh Linux host also run: sudo $(PY) -m playwright install-deps chromium"

env: ## Create .env from .env.example with freshly generated JWT_SECRET and TOKEN_ENCRYPTION_KEY
	@if [ -f .env ]; then echo ".env already exists; not overwriting"; exit 0; fi; \
	jwt="$$($(PY) -c 'import secrets; print(secrets.token_urlsafe(64))')"; \
	fernet="$$($(PY) -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')"; \
	sed -e "s|^JWT_SECRET=$$|JWT_SECRET=$$jwt|" -e "s|^TOKEN_ENCRYPTION_KEY=$$|TOKEN_ENCRYPTION_KEY=$$fernet|" \
	    .env.example > .env; \
	chmod 600 .env; \
	echo "Wrote .env (JWT_SECRET and TOKEN_ENCRYPTION_KEY generated). Set GEMINI_API_KEY / GOOGLE_* as needed."

run: ## Run the API with auto-reload on $(HOST):$(PORT)
	$(PY) -m uvicorn --factory app.main:app_factory --reload --host $(HOST) --port $(PORT)

worker: ## Run a background worker on $(WORKER_QUEUES)
	$(PY) -m app.workers.worker --queues $(WORKER_QUEUES)

browser-worker: ## Run the isolated browser worker (needs `make install-browser`)
	$(BIN)/agentos-browser-worker

scheduler: ## Run the scheduler (automations + periodic maintenance jobs)
	$(PY) -m app.workers.scheduler.scheduler

test: ## Run the whole test suite (needs PostgreSQL + Redis)
	$(PY) -m pytest

test-unit: ## Unit tests only
	$(PY) -m pytest tests/unit

test-integration: ## Tests marked `integration` (PostgreSQL + Redis)
	$(PY) -m pytest -m integration

test-e2e: ## End-to-end task lifecycle tests (acceptance + failure scenarios)
	$(PY) -m pytest -m e2e tests/e2e

test-security: ## Tests marked `security`
	$(PY) -m pytest -m security

lint: ## Ruff lint
	$(BIN)/ruff check app tests scripts

format: ## Apply ruff's safe autofixes (import order, pyupgrade, ...); the code base is hand-wrapped, not `ruff format`ted
	$(BIN)/ruff check --fix app tests scripts

typecheck: ## mypy
	$(BIN)/mypy app

migrate: ## Apply database migrations (alembic upgrade head)
	$(PY) -m alembic upgrade head

migration: ## Autogenerate a migration: make migration m="describe the change"
	@if [ -z "$(m)" ]; then echo 'usage: make migration m="describe the change"'; exit 2; fi
	$(PY) -m alembic revision --autogenerate -m "$(m)"

seed: ## Create idempotent demo data (refuses to run in staging/production)
	$(PY) scripts/seed.py

docker-up: ## Build and start the Compose stack (PROFILES="browser minio observability" for extras)
	$(COMPOSE) $(COMPOSE_PROFILES_ARGS) up -d --build

docker-down: ## Stop the Compose stack (data volumes are kept)
	$(COMPOSE) $(COMPOSE_PROFILES_ARGS) down

docker-logs: ## Follow Compose logs
	$(COMPOSE) $(COMPOSE_PROFILES_ARGS) logs -f --tail=200

load-test: ## Headless Locust run (LOAD_HOST, LOAD_USERS, LOAD_SPAWN_RATE, LOAD_DURATION, LOAD_TAGS, LOAD_CSV)
	@mkdir -p $(dir $(LOAD_CSV))
	$(BIN)/locust -f tests/load/locustfile.py --headless --host $(LOAD_HOST) \
	    -u $(LOAD_USERS) -r $(LOAD_SPAWN_RATE) -t $(LOAD_DURATION) --csv $(LOAD_CSV) --csv-full-history \
	    --only-summary $(LOAD_TAG_ARGS)

openapi: ## Export the OpenAPI schema to docs/openapi.json
	$(PY) scripts/export_openapi.py --output docs/openapi.json

eval: ## Run the evaluation suite (EVAL_SUITE=core)
	$(PY) -m app.evaluation.cli run --suite $(EVAL_SUITE)
