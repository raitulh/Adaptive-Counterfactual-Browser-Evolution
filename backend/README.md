# AgentOS backend

AgentOS is an action-taking, tool-using, **self-verifying** AI agent platform. A user states
a goal ("find a free slot tomorrow after 2 PM, invite Rahim and e-mail him a confirmation");
AgentOS plans it, checks every step against permissions and policy, asks for approval where a
person must decide, executes real actions (Gmail, Calendar, Drive, Contacts, web, MCP tools,
an isolated browser), verifies each effect against the external system, recovers from
failures without duplicating side effects, and reports only what it verified.

> **LLM proposes. Backend decides. Tools execute. Verifier confirms.**

It is a modular monolith (FastAPI, SQLAlchemy 2 async, PostgreSQL 16 + pgvector, Redis) with
durable workers. Start with [docs/architecture.md](docs/architecture.md).

## Quickstart (local, without Docker)

Prerequisites: Python 3.11, PostgreSQL 16 with the `pgvector` extension, Redis 7, and a
Gemini API key for planning (<https://aistudio.google.com/apikey>).

```bash
# Database role and databases. pgvector is not a "trusted" extension: creating it needs a
# superuser. The first migration runs CREATE EXTENSION IF NOT EXISTS vector, and the test
# suite drops and recreates the schema (and the extension) — so for LOCAL development make
# the role a superuser. In production pre-create the extension or use a role allowed to.
createuser --superuser -P agentos    # password: agentos (local development only)
createdb -O agentos agentos
createdb -O agentos agentos_test

cd backend
make install        # .venv with the root `acbe` package + backend[dev,otlp] (editable)
make env            # .env from .env.example with generated JWT_SECRET and TOKEN_ENCRYPTION_KEY
$EDITOR .env        # set GEMINI_API_KEY (and GOOGLE_CLIENT_ID/SECRET to use Google tools)
make migrate        # alembic upgrade head + python -m app.cli sync-tools
make seed           # demo organization, user (password printed once), agent, policy, tool rule
make run            # API on http://127.0.0.1:8000  (docs: /docs)
make worker         # second terminal: planning, execution, memory, notifications, files, maintenance
make scheduler      # third terminal: automations + periodic maintenance
```

Optional processes: `make eval-worker` (evaluation runs and ACBE experiments — the only
consumer of the `evaluation` queue) and `make install-browser && make browser-worker`
(Playwright/Chromium browser tools). Without `make`, use `scripts/dev.sh <command>`.

## Quickstart (Docker Compose)

```bash
cd backend
make env                                   # or: cp .env.example .env and set the two secrets
docker compose up -d --build               # postgres, redis, migrate, api, worker, scheduler
curl -s http://127.0.0.1:8000/api/v1/ready
docker compose exec api python scripts/seed.py
```

Profiles: `--profile browser` (browser worker), `--profile minio` (S3-compatible storage),
`--profile observability` (OpenTelemetry collector), `--profile evaluation` (evaluation
worker). The stack is sized for an 8 GB machine; see [docs/deployment.md](docs/deployment.md).

## Example API session

```bash
API=http://127.0.0.1:8000/api/v1
TOKEN=$(curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Str0ng!Passw0rd","timezone":"Asia/Dhaka"}' | jq -r .access_token)

# connect Google with least-privilege capabilities, then open authorization_url in a browser
curl -s -X POST $API/integrations/google/connect -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"capabilities":["calendar.read","calendar.write","gmail.send","contacts.read"]}'

# create a task (202; executed by workers)
TASK=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: demo-1" \
  -d '{"goal":"Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with Rahim, and send him a confirmation email."}' \
  | jq -r .task_id)

# review and approve the pending action (bound to the exact arguments shown), repeat for the e-mail
curl -s "$API/approvals?status=pending&task_id=$TASK" -H "Authorization: Bearer $TOKEN" | jq '.items[] | {id, summary, arguments_preview}'
curl -s -X POST $API/approvals/<approval id>/approve -H "Authorization: Bearer $TOKEN"

# what happened, what changed, what was verified
curl -s $API/tasks/$TASK/summary -H "Authorization: Bearer $TOKEN" | jq
```

Streaming (SSE), pagination, idempotency, errors and the full endpoint list:
[docs/api.md](docs/api.md).

## Tests

The suite needs PostgreSQL (with pgvector) and Redis. `tests/conftest.py` uses
`TEST_DATABASE_URL` (default `postgresql+asyncpg://agentos:agentos@localhost:5432/agentos_test`)
and `TEST_REDIS_URL` (default `redis://localhost:6379/15`) and builds the schema by running the
migrations (`TEST_SCHEMA_MODE=alembic`).

```bash
make test               # everything
make test-unit          # tests/unit
make test-integration   # -m integration (PostgreSQL + Redis)
make test-e2e           # acceptance and failure scenarios end to end
make test-security      # -m security
make lint typecheck
```

Tests marked `browser` need Playwright + Chromium (`make install-browser`). Load tests live in
[tests/load/](tests/load/README.md) (Locust, `pip install -e ".[load]"`, `make load-test`).

## Evaluation suite

```bash
make eval                                            # python -m app.evaluation.cli run --suite core
.venv/bin/python -m app.evaluation.cli list          # suites and cases
```

Each case runs end to end through the real planner, permission engine, approvals, execution
engine and verification against a simulated Google Workspace, in an isolated organization.
The command exits non-zero if any unauthorized action or false completion occurs — use it as
a release gate. See [docs/acbe.md](docs/acbe.md).

## Operator CLI

```bash
.venv/bin/python -m app.cli check-config             # validate configuration like startup does
.venv/bin/python -m app.cli sync-tools               # mirror built-in tool specs into the database
.venv/bin/python -m app.cli promote-admin <email>    # grant platform admin (audited)
.venv/bin/python scripts/wait_for_services.py        # wait for PostgreSQL/Redis
.venv/bin/python scripts/export_openapi.py           # docs/openapi.json (also: make openapi)
```

## Project layout

```
backend/
├── app/
│   ├── main.py                 # application factory (uvicorn --factory app.main:app_factory)
│   ├── cli.py                  # operator CLI
│   ├── api/                    # router composition, dependencies, errors, health
│   ├── core/                   # config, database + tenant guard, redis, logging, metrics, tracing, crypto
│   ├── common/                 # ids, events/outbox, idempotency, pagination, redaction, sanitize, flags
│   ├── auth/ users/ organizations/ permissions/
│   ├── agents/ tasks/ planner/ execution/ approvals/ verification/ recovery/
│   ├── tools/                  # tool interface, registry, built-in Google/compute tools
│   ├── integrations/           # Google OAuth, credential vault, webhooks
│   ├── mcp/ browser/ memory/ files/ search/ model_gateway/
│   ├── automations/ notifications/ audit/ usage/ billing/ admin/
│   ├── acbe/ evaluation/       # controlled self-improvement, evaluation harness + CLI
│   └── workers/                # queue, worker process, scheduler, maintenance jobs
├── migrations/                 # Alembic (the only way the schema changes)
├── scripts/                    # seed, export_openapi, wait_for_services, demo MCP server, dev.sh
├── tests/                      # unit/, integration/, e2e/, fakes/, load/
├── docs/                       # this documentation
├── deploy/
│   ├── docker/                 # browser worker Dockerfile, collector config
│   ├── k8s/                    # kustomize base
│   └── terraform/              # GCP reference infrastructure
├── Dockerfile                  # API / worker / scheduler image (build context: repository root)
├── docker-compose.yml
├── Makefile
├── .env.example                # every setting, documented
└── pyproject.toml
```

## Documentation

| Document | Contents |
|---|---|
| [architecture.md](docs/architecture.md) | processes, module map, request and task lifecycles, data flow |
| [agent-execution.md](docs/agent-execution.md) | planner → validator → policy → approvals → engine → ledger → verification → recovery, worked example |
| [security.md](docs/security.md) | auth, sessions, RBAC, tenant isolation, encryption, SSRF, prompt injection, audit, retention |
| [api.md](docs/api.md) | conventions, SSE, endpoint catalogue, curl examples |
| [integrations.md](docs/integrations.md) | Google OAuth setup and verification, MCP servers, browser worker |
| [acbe.md](docs/acbe.md) | controlled learning lifecycle and safety gates, evaluation |
| [deployment.md](docs/deployment.md) | local, Compose, Kubernetes, migrations, scaling, DR, observability |
| [operations.md](docs/operations.md) | runbooks and incident checklist |
| [limitations.md](docs/limitations.md) | external prerequisites and known limitations |
| [backend-conventions.md](docs/backend-conventions.md) | how to write a module |

The original ACBE library and its documentation live at the repository root (`acbe/`,
`docs/`); the backend depends on that package.
