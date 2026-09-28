# AgentOS load tests (Locust)

`locustfile.py` simulates end users of the AgentOS API. It is **not** part of the pytest
suite (pytest does not collect it) and is excluded from mypy. Locust is the `load` extra:

```bash
.venv/bin/pip install -e ".[load]"
```

Never point it at production: it creates accounts, tasks, memories and approvals.

## Scenarios (tags)

Each scenario is a Locust tag, so any subset can run on its own (`--tags polling events`).
Every simulated user first gets an account (self-registration, or a pre-provisioned one)
and, by default, creates one task so that polling has data (`AGENTOS_LOAD_SEED_TASKS`).

| Tag | Requests | What it stresses |
|---|---|---|
| `auth` | `POST /auth/register` (once per user), `POST /auth/login`, `POST /auth/refresh` | Argon2 password hashing (deliberately CPU-heavy), session rows, refresh-token rotation with reuse detection, per-IP and per-account auth rate limits |
| `tasks` | `POST /tasks` with `Idempotency-Key` | request validation, quota checks, the idempotency table, task + event + outbox + job inserts in one transaction |
| `polling` | `GET /tasks/{id}`, `GET /tasks?limit=20` | tenant-scoped reads, keyset pagination |
| `events` | `GET /tasks/{id}/events?after_seq=N` | the ordered event log (`task_events`) — the SSE-less alternative to streaming |
| `memory` | `POST /memory/search`, occasional `POST /memory` | hybrid search (pgvector + keyword) and the embedding call to the model provider |
| `approvals` | `GET /approvals?status=pending`, `POST /approvals/{id}/approve` | approval reads; decisions lock the task and approval rows |
| `tools` | `GET /tools` | tool catalogue + per-tool permission evaluation |

Environment variables: `AGENTOS_API_PREFIX` (default `/api/v1`), `AGENTOS_LOAD_USERS_FILE`
(CSV `email,password` of pre-provisioned accounts), `AGENTOS_LOAD_EMAIL_DOMAIN`,
`AGENTOS_LOAD_SEED_TASKS` (default 1), `AGENTOS_LOAD_WAIT_MIN`/`MAX` (think time, default
1–5 s), `AGENTOS_LOAD_MAX_FAIL_RATIO` (default 0.01; Locust also exits non-zero on any failure).

With the default think time each simulated user sends roughly one request every 3 s, so
1K users ≈ 330 req/s, 10K ≈ 3.3K req/s and 100K ≈ 33K req/s against the API.

## Prepare the target environment

The defaults are production protections and will dominate the results unless you decide
what you are measuring:

* **Rate limits.** A few load-generator IPs hit `RATE_LIMIT_IP_PER_MINUTE` (300) and
  `RATE_LIMIT_AUTH_PER_MINUTE` (10) almost immediately. To measure application throughput,
  raise `RATE_LIMIT_*` on the target; to measure the limiter itself, keep them and expect 429s.
* **Plans and concurrency.** New accounts get `DEFAULT_PLAN` (free: 3 concurrent tasks,
  200 tasks/month) capped by `MAX_CONCURRENT_TASKS_PER_USER` (10). Without workers draining
  tasks, `POST /tasks` soon returns 429 `too_many_active_tasks`. Use `DEFAULT_PLAN=enterprise`
  in the load environment, run workers, or treat those 429s as the quota being measured.
* **Model provider.** Every task is planned by the model and memory search embeds the query.
  With Gemini this costs money and consumes quota. Measure platform throughput in a
  dedicated performance environment with `MODEL_PROVIDER=scripted` (allowed only outside
  staging/production; planning then fails fast, which still exercises the queue), and use
  Gemini only for the provider-quota profile below.
* **Accounts.** Registration is intentionally expensive. Above ~1K users, pre-provision
  accounts once at a controlled rate and pass them with `AGENTOS_LOAD_USERS_FILE`:

  ```bash
  for i in $(seq 1 10000); do
    email="load-$i@loadtest.example.com"; pass="Lt-$(openssl rand -hex 8)9a!"
    curl -fsS -o /dev/null -X POST "$HOST/api/v1/auth/register" -H 'Content-Type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$pass\"}" && echo "$email,$pass" >> users.csv
  done
  ```
* **Observability.** Scrape `/metrics` (API) and the worker metrics port, and watch
  PostgreSQL (`pg_stat_activity`, locks, replication lag) and Redis (ops/s, latency, memory)
  during the run.

## Running

Headless with CSV output (a single process handles a few thousand users with think time):

```bash
make load-test LOAD_HOST=https://perf.example.com LOAD_USERS=1000 LOAD_SPAWN_RATE=50 \
    LOAD_DURATION=15m LOAD_CSV=loadtest-results/1k
# equivalent:
.venv/bin/locust -f tests/load/locustfile.py --headless --host https://perf.example.com \
    -u 1000 -r 50 -t 15m --csv loadtest-results/1k --csv-full-history --html loadtest-results/1k.html
```

This writes `1k_stats.csv`, `1k_stats_history.csv`, `1k_failures.csv` and `1k_exceptions.csv`.

Distributed (10K / 100K): one master and N worker processes, each worker on its own core.

```bash
locust -f tests/load/locustfile.py --master --headless --expect-workers 8 \
    --host https://perf.example.com -u 10000 -r 100 -t 30m --csv loadtest-results/10k --csv-full-history
# on each load-generator host (one per core):
locust -f tests/load/locustfile.py --worker --master-host <master-ip>
```

## Staged profiles

Run the stages in order and fix the first saturated resource before moving on. Each stage
names the bottleneck it is designed to expose.

| Stage | Users | Spawn rate | Duration | Load generators | Tags | Bottleneck measured | Watch |
|---|---|---|---|---|---|---|---|
| **1K** | 1,000 | 50/s | 15 min | 1 process, 2 vCPU | all | **API CPU** per replica; HPA reaction time | `api_latency_seconds` p95/p99, pod CPU, HPA replica count |
| **10K-a** | 10,000 | 100/s | 30 min | master + 4–8 workers | `polling events tools approvals` | **PostgreSQL connection pool**: replicas × (`DATABASE_POOL_SIZE` + `DATABASE_MAX_OVERFLOW`) vs `max_connections`; pool-timeout errors | `pg_stat_activity` count, 5xx with pool timeouts, DB CPU |
| **10K-b** | 10,000 | 100/s | 30 min | master + 4–8 workers | `tasks polling events` (workers running) | **Queue claim throughput** (`FOR UPDATE SKIP LOCKED` on `jobs`) and worker concurrency | `jobs_in_flight`, `jobs_processed_total` rate, age of the oldest pending job (`GET /admin/system`) |
| **100K-a** | 100,000 | 250/s | 60 min | master + 25–50 workers | `polling events tools` with default rate limits | **Redis rate limiter**: one Lua round trip per scope per request (ip, user, tenant, route) | Redis ops/s and latency, `rate_limited_total` (incl. `*:redis_error`), API p99 |
| **100K-b** | 100,000 | 250/s | 60 min | master + 25–50 workers | `tasks memory` with `MODEL_PROVIDER=gemini` and a small `-u` share | **Model provider quota** (requests/tokens per minute) and planner latency | `model_latency_seconds`, `model_error_total{error="ModelRateLimited"}`, tasks failing with `model_rate_limited` |

Suggested pass criteria (adapt to your SLOs): no 5xx; failure ratio below 1% excluding the
429s a stage deliberately measures; p95 below 300 ms for reads and 800 ms for writes;
oldest pending job younger than 5 s at steady state.

## Do not extrapolate

These profiles measure **one deployment at the sizes tested**. They say nothing reliable
about orders of magnitude beyond them — in particular, **do not extrapolate "billion-user"
capacity from 1K/10K/100K benchmarks**. Capacity is not linear: a single PostgreSQL primary
has a write ceiling, connection counts and lock contention grow with replicas, the job queue
and event tables need partitioning at volume, Redis and the model provider have their own
quotas, cross-region latency and failover change the picture, and simulated users do not
reproduce real usage mixes. Claims about much larger scale require staged tests at that
scale, a capacity model validated against them, and the architectural steps described in
`docs/deployment.md` (partitioning, read replicas, regional cells).
