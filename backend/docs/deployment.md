# Deploying and operating AgentOS at scale

| Artifact | Where |
|---|---|
| API / worker / scheduler / evaluation-worker / migration image | `backend/Dockerfile` (target `api`) |
| Browser worker image (Playwright + Chromium) | `backend/deploy/docker/Dockerfile.browser` |
| Local stack | `backend/docker-compose.yml` |
| Kubernetes base (kustomize) | `backend/deploy/k8s/` |
| Reference cloud infrastructure (GCP) | `backend/deploy/terraform/` |
| CI | `.github/workflows/backend-ci.yml` |

Both images are built with the **repository root** as the build context (they install the
root `acbe` package too), run as uid 10001 and contain no compilers:

```bash
docker build -f backend/Dockerfile -t agentos-backend:0.1.0 .
docker build -f backend/deploy/docker/Dockerfile.browser -t agentos-browser-worker:0.1.0 .
```

## Local development on an 8 GB machine

### Without Docker

Requirements: Python 3.11, PostgreSQL 16 with the `pgvector` extension, Redis 7.

```bash
cd backend
make install            # .venv with the root acbe package + backend[dev,otlp]
make env                # .env from .env.example with generated JWT_SECRET / TOKEN_ENCRYPTION_KEY
make migrate            # alembic upgrade head + python -m app.cli sync-tools
make seed               # demo user, organization, agent, policy and tool rule
make run                # API with reload on 127.0.0.1:8000
make worker             # in another terminal (general queues)
make scheduler          # in another terminal
make eval-worker        # optional: evaluation runs and ACBE (the `evaluation` queue)
```

Memory tips: one worker process with `WORKER_CONCURRENCY=2–4`, `DATABASE_POOL_SIZE=5`,
`DATABASE_MAX_OVERFLOW=5`. The browser worker (`make install-browser`,
`make browser-worker`) needs ~1 GB more; skip it unless you work on browser tools. The test
suite uses a separate database: `createdb -O agentos agentos_test` (see `tests/conftest.py`
for `TEST_DATABASE_URL`, `TEST_REDIS_URL`, `TEST_SCHEMA_MODE`). pgvector is not a *trusted*
extension, and both the first migration and the test suite (which drops and recreates the
schema) create it, so the local role must be a superuser (`createuser --superuser agentos`);
the Compose `postgres` user already is.

### Docker Compose

```bash
cd backend
make env                                  # or: cp .env.example .env and fill the two secrets
docker compose up -d --build              # postgres, redis, migrate (one-shot), api, worker, scheduler
docker compose --profile browser up -d    # + browser-worker
docker compose --profile minio up -d      # + S3-compatible storage and bucket creation
docker compose --profile observability up -d   # + OpenTelemetry collector
docker compose --profile evaluation up -d # + dedicated evaluation/ACBE worker
docker compose logs -f api worker
```

| Service | Memory limit | Notes |
|---|---|---|
| postgres (`pgvector/pgvector:pg16`) | 1 GiB | `shared_buffers=256MB`, `max_connections=150`, port 127.0.0.1:5432 |
| redis (`redis:7-alpine`) | 256 MiB | AOF on, `maxmemory 192mb`, `volatile-lru` |
| migrate | 256 MiB | waits for PostgreSQL/Redis, `alembic upgrade head`, `python -m app.cli sync-tools`, exits |
| api | 512 MiB | 127.0.0.1:8000 |
| worker | 768 MiB | `planning,execution,memory,notifications,files,maintenance`; metrics on :9100 inside the network |
| scheduler | 256 MiB | |
| browser-worker (profile) | 1.5 GiB | `shm_size 512m`, read-only root, Chromium sandbox off (container boundary) |
| minio + minio-init (profile) | 512 MiB | set `OBJECT_STORAGE_BACKEND=s3`, `OBJECT_STORAGE_ENDPOINT=http://minio:9000` |
| otel-collector (profile) | 256 MiB | set `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318/v1/traces` |
| evaluation-worker (profile) | 512 MiB | `--queues evaluation` only — without it evaluation/ACBE jobs wait in the queue |

Core stack ≈ 2.8 GB of limits. Application containers run read-only with `/tmp` on tmpfs,
all capabilities dropped and `no-new-privileges`. `docker compose down -v` also deletes the
data volumes. With the MinIO profile, presigned download URLs contain the in-network host
`minio:9000`; for browser downloads during local development either keep the local storage
backend or map `minio` to 127.0.0.1 in your hosts file.

## Kubernetes

The base in `deploy/k8s/` targets GKE Autopilot but uses only portable resources.

Prerequisites in the cluster: an ingress controller (manifests use ingress-nginx), cert-manager
(or another way to get the `agentos-api-tls` certificate), External Secrets Operator (or a
manually created Secret), metrics-server for the HPAs, and optionally Prometheus and an OTLP
collector (`observability` namespace).

| Manifest | Contents |
|---|---|
| `namespace.yaml` | namespace with Pod Security `restricted` |
| `configmap.yaml` | non-secret settings (production values) |
| `secret.example.yaml` | *example only*: ExternalSecret (Secret Manager) or a plain Secret |
| `api-deployment.yaml`, `api-service.yaml`, `api-hpa.yaml` | API: 2+ replicas, probes on `/api/v1/live` and `/api/v1/ready`, zone/host spread, HPA on CPU |
| `worker-deployment.yaml`, `worker-hpa.yaml` | general workers (+ the optional dedicated evaluation worker, 0 replicas by default); HPA on CPU, KEDA queue-depth example |
| `scheduler-deployment.yaml` | 1 replica (2 is safe) |
| `browser-worker-deployment.yaml` | isolated browser workers + strict egress NetworkPolicy |
| `migrate-job.yaml` | `alembic upgrade head && python -m app.cli sync-tools` Job |
| `ingress.yaml` | TLS, 26 MiB bodies, SSE-friendly (buffering off, 1 h timeouts), only `/api/` routed |
| `networkpolicy.yaml` | default deny + explicit allows |
| `pdb.yaml` | disruption budgets |

Every pod runs as uid 10001, non-root, read-only root filesystem, all capabilities dropped,
`RuntimeDefault` seccomp, no service-account token. Create an overlay per environment:

```yaml
# deploy/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../../backend/deploy/k8s
images:
  - name: agentos-backend
    newName: europe-west1-docker.pkg.dev/my-project/agentos/agentos-backend
    newTag: "2026.09.28-1"
  - name: agentos-browser-worker
    newName: europe-west1-docker.pkg.dev/my-project/agentos/agentos-browser-worker
    newTag: "2026.09.28-1"
patches:
  - target: {kind: ConfigMap, name: agentos-config}
    patch: |-
      - op: replace
        path: /data/PUBLIC_BASE_URL
        value: https://api.example.com
      - op: replace
        path: /data/OBJECT_STORAGE_BUCKET
        value: my-project-agentos-prod-objects
```

Adapt as well: the ingress host, the Workload Identity annotations (Terraform output
`workload_service_accounts`), `FORWARDED_ALLOW_IPS` (ingress controller Pod range) and the
private-services CIDR `10.100.0.0/16` in the NetworkPolicies (Terraform
`private_services_cidr`).

### Release procedure

```bash
# 1. build and push both images with an immutable tag (Artifact Registry has immutable tags)
# 2. migrations first — they must be backward compatible with the running release
kubectl -n agentos delete job agentos-migrate --ignore-not-found
kubectl apply -k deploy/overlays/prod -l app.kubernetes.io/component=migrate
kubectl -n agentos wait --for=condition=complete job/agentos-migrate --timeout=15m
# 3. roll out everything
kubectl apply -k deploy/overlays/prod
kubectl -n agentos rollout status deploy/agentos-api deploy/agentos-worker deploy/agentos-scheduler
```

Rolling updates are safe for workers: on SIGTERM a worker stops claiming, drains in-flight
jobs for `WORKER_SHUTDOWN_GRACE_SECONDS`, and anything cut off is resumed by another worker
when its lease expires (side-effecting steps are reconciled, not re-run). The API drains with
a 5 s pre-stop delay and uvicorn's graceful shutdown; SSE clients reconnect with
`Last-Event-ID`.

## Migrations

* Schema changes are made **only** with Alembic (`migrations/versions/`); the application
  never calls `create_all`. `make migration m="add x"` autogenerates a revision from the
  models — always review it.
* **Expand → migrate → contract**: add nullable columns/new tables first, deploy code that
  writes both, backfill in batches (a job or a one-off script, not inside the migration
  transaction for large tables), then remove the old shape in a later release.
* Indexes on large tables: `CREATE INDEX CONCURRENTLY` inside
  `with op.get_context().autocommit_block():`.
* Rollback strategy: prefer forward fixes; downgrades exist for development but are not a
  production recovery tool once data was written in the new shape.
* CI applies all migrations to an empty database on every change and the test suite builds
  its schema from them.
* The migration chain is `0001_initial_schema` → `0002_rbac_seed_audit_guard` (RBAC
  catalogue + append-only audit trigger); on a fresh database `alembic upgrade head` followed
  by `alembic check` reports no drift (CI runs both).
* The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. The role in
  `DATABASE_URL` must be allowed to create it, **or** a superuser must create it in the
  database beforehand. On managed PostgreSQL enable pgvector for the instance/database
  (Cloud SQL: available, created by a `cloudsqlsuperuser` member; Azure Flexible Server:
  allow-list `vector` in `azure.extensions`; RDS/Aurora: supported, created by the master user).
* After migrating, `python -m app.cli sync-tools` (idempotent) mirrors the built-in tool
  specifications into `tool_definitions`/`tool_versions`; every migrate step here runs it.

## Scaling

### API

Stateless; scale on CPU (HPA) or request rate. The limit is the PostgreSQL connection
budget:

```
connections ≈ Σ over process types (replicas × (DATABASE_POOL_SIZE + DATABASE_MAX_OVERFLOW)) + admin headroom
e.g. API 20 × 15 + workers 30 × 15 + evaluation 1 × 15 + scheduler 2 × 15 + browser 10 × 15 = 945
```

Keep that under the server's `max_connections` (Terraform default 400), or put PgBouncer in
front. With PgBouncer in transaction mode note that the engine sends `statement_timeout` as a
startup parameter (add it to `ignore_startup_parameters`) and that asyncpg uses prepared
statements (PgBouncer ≥ 1.21 with `max_prepared_statements`, or disable asyncpg's statement
cache).

### Workers

* Any worker can drive any task; a task is driven by one worker at a time (DB lease).
  Throughput scales with replicas × `WORKER_CONCURRENCY` until the database or providers
  saturate.
* Split noisy queues into separate Deployments (`--queues execution`,
  `--queues memory,files`, …) to isolate latency-sensitive planning/execution.
* Scale on **queue depth** (claimable `jobs` rows) with KEDA — example in `worker-hpa.yaml` —
  rather than CPU: most time is spent waiting on the model and Google APIs.
* Watch `jobs_in_flight`, `jobs_processed_total{outcome}` and the oldest pending job
  (`GET /api/v1/admin/system`).
* The `evaluation` queue (evaluation runs, ACBE failure analysis and experiments) is served
  only by the dedicated `--queues evaluation` worker (1 replica, concurrency 1). It ships
  scaled to 0; scale it to 1 to enable evaluation/ACBE — until then those jobs wait.

### Browser workers

Separate Deployment and image; concurrency `BROWSER_MAX_CONCURRENCY` per pod (each task gets a
fresh context in a shared Chromium that is recycled periodically). Scale on the `browser`
queue depth. Give them their own node pool and, where available, GKE Sandbox (gVisor).

### Scheduler

One replica is enough (it only enqueues). Two are safe: automation runs are unique per
(automation, scheduled time) and periodic jobs use time-bucketed dedupe keys.

### Redis

Transient state only (rate limits, locks, OAuth state, SSE wake-ups). Losing it logs users
out of nothing and loses no task state; the limiter fails open by default. Each request costs
~3–4 Lua calls (IP, user, tenant, route); at very high request rates use a larger/HA tier or
Redis Cluster (keys are independent).

### PostgreSQL

Scale vertically first (CPU, memory, SSD IOPS), tune autovacuum for the high-churn tables
(`jobs`, `task_events`, `outbox_events`, `api_idempotency_keys`), then add read replicas and
partitioning as below.

## Database partitioning plan

Not implemented yet — this is the plan for when the tables outgrow comfortable vacuum and
retention by `DELETE`:

| Table | Partitioning | Retention | Notes |
|---|---|---|---|
| `task_events` | `RANGE (created_at)`, monthly | drop/detach partitions older than `RETENTION_TASK_EVENTS_DAYS` whose tasks are all terminal; residual rows by batched `DELETE` | primary key becomes `(id, created_at)`; per-task gap-free `seq` is already guaranteed by the task row lock, so `(task_id, seq)` uniqueness can be enforced per partition as `(task_id, seq, created_at)` |
| `usage_events` | `RANGE (occurred_at)`, monthly | drop partitions older than `RETENTION_USAGE_EVENTS_DAYS` after `usage_aggregates` are final | append-only; billing reads aggregates |
| `audit_logs` | `RANGE (created_at)`, monthly | detach + archive to object storage, then drop | keep the append-only trigger on the partitioned table (inherited by partitions); partition DDL must be restricted to a separate owner role because `DROP` bypasses row triggers |
| `jobs` | not partitioned; kept small by `maintenance.cleanup_jobs` | succeeded 7 days, dead 30 days | at very high volume, move enqueue/claim to Pub/Sub or Kafka behind the `JobQueue` protocol |

Use `pg_partman` (or an equivalent scheduled job) to pre-create partitions. Convert each table
with an Alembic migration that creates the partitioned table, backfills in batches and swaps
names in a short maintenance window; the application code does not change.

## Read replicas

Candidates for replica reads: task lists and details, event polling, audit and usage
queries, admin dashboards, evaluation reports. Must stay on the primary: authentication
(session/membership checks), anything followed by a write, approvals, idempotency keys, the
job queue and the execution engine. The application currently uses a single engine; adding
replicas means a second, read-only session factory for the listed read paths, with SSE/event
readers tolerating replica lag (they already resume by sequence number).

## Multi-region evolution path

1. **Single region, multi-zone (today's reference)**: regional Cloud SQL (HA), `STANDARD_HA`
   Memorystore, GKE Autopilot across zones, versioned bucket.
2. **Disaster recovery region**: cross-region Cloud SQL replica (promotable), images and
   secrets replicated, a dual- or multi-region bucket, infrastructure applied from the same
   Terraform with another `region`. Failover = promote the replica, point `DATABASE_URL` at it,
   scale up the standby cluster, move DNS.
3. **Regional cells with data residency**: each region runs a complete, independent stack;
   every organization has a home region (`organizations.data_region`, taken from `APP_REGION`
   at creation, and `region` is recorded on each task). A thin global layer (tenant → region
   directory, global login/routing) sends requests to the home cell. No synchronous
   cross-region writes; cross-region consumers read the outbox through Kafka/PubSub behind the
   `EventBus` interface. The directory and routing layer do not exist yet.

## Backups and disaster recovery

| Data | Mechanism | Target |
|---|---|---|
| PostgreSQL | automated daily backups (14 retained by default) + point-in-time recovery (7 days of WAL); periodic `gcloud sql export` to a locked bucket for long-term copies | RPO ≤ 5 min (PITR), RTO < 1 h for restore-to-new-instance |
| Object storage | versioning, soft delete (7 days), non-current versions kept 30 days | object-level undelete |
| Redis | none needed (transient) | — |
| Secrets / keys | Secret Manager versions; KMS keys cannot be deleted (only versions destroyed after a delay) | — |

Restore drill (run it quarterly): restore a backup or PITR clone to a new instance → run
`alembic current` → update the `agentos-database-url` secret → restart API and workers. Tasks
resume from durable state; any `external_actions` row left `pending` is reconciled against the
provider before anything is retried, so a restore cannot silently duplicate side effects.

## Observability

* **Logs**: JSON to stdout (`LOG_JSON=true`): `ts`, `level`, `logger`, `message` plus
  correlation fields `request_id`, `trace_id`, `tenant_id`, `user_id`, `task_id`, `step_id`;
  a redaction filter scrubs secrets; access logs come from the request middleware. Prompts and
  completions are never logged.
* **Metrics**: Prometheus text format on `GET /metrics` (API; optional bearer token) and on
  `WORKER_METRICS_PORT` (workers). Key series: `api_requests_total`, `api_latency_seconds`,
  `task_created_total`, `task_completed_total`, `task_failed_total{reason}`,
  `task_state_transitions_total`, `tool_calls_total`, `tool_error_total`,
  `tool_latency_seconds`, `verification_pass_total` / `verification_fail_total`,
  `approval_requests_total`, `approval_wait_time_seconds`, `model_latency_seconds`,
  `model_error_total`, `model_tokens_total`, `jobs_in_flight`, `jobs_processed_total`,
  `retry_total`, `rate_limited_total`, `browser_task_latency_seconds`.
* **Traces**: OpenTelemetry spans `http.request`, `task.plan`, `task.execute`,
  `tool.execute`, `tool.verify`, `tool.reconcile`, `model.generate`, `model.embed`,
  `job.run`; exported over OTLP/HTTP when `OTEL_ENABLED=true` and
  `OTEL_EXPORTER_OTLP_ENDPOINT` is the full traces URL (`…/v1/traces`); requires the `otlp`
  extra (included in the image).
* **Errors**: set `SENTRY_DSN` and install the `sentry` extra (`pip install ".[sentry]"`) to
  report exceptions (`send_default_pii=False`); otherwise they are logged.
* **Health**: `/api/v1/live`, `/api/v1/ready`, `/api/v1/health`; platform view:
  `GET /api/v1/admin/system` (workers, queue depth per status, oldest pending job, tasks by
  state) and `GET /api/v1/admin/jobs/dead`.

Suggested alerts:

| Alert | Condition |
|---|---|
| API errors | 5xx ratio > 1% for 5 min |
| API latency | p95 `api_latency_seconds` > 1 s for 10 min |
| Queue backlog | oldest pending job > 60 s, or pending count growing for 15 min |
| Dead letters | any new `dead` job |
| Workers missing | no worker heartbeat in 60 s |
| Verification failures | `verification_fail_total` rate spike vs baseline |
| Approvals | `approval_requests_total{outcome="expired"}` rising |
| Model provider | `model_error_total` rate > 5% |
| Rate limiter degraded | `rate_limited_total{scope=~".*:redis_error"}` > 0 |
