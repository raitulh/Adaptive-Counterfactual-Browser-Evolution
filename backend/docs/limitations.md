# Limitations and external prerequisites

AgentOS is honest about what it verified; this page is honest about what it needs from the
outside world and where it is incomplete.

## External prerequisites

These are not bugs — the platform cannot work (fully) without them:

| Prerequisite | Needed for | Notes |
|---|---|---|
| **PostgreSQL 16 with pgvector** | everything | the migration role must be allowed to `CREATE EXTENSION vector`, or a superuser must create it first (managed PostgreSQL: enable pgvector) |
| **Redis 7** | rate limiting, OAuth state, locks, SSE wake-ups | transient data only; `/api/v1/ready` requires it |
| **Gemini API key and quota** | planning, memory embeddings/extraction | required in staging/production (`MODEL_PROVIDER=gemini`); throughput and cost are bounded by the provider's quota |
| **Google Cloud OAuth client** | Gmail, Calendar, Drive, Contacts, Sign in with Google | APIs enabled, consent screen, exact redirect URIs ([integrations.md](integrations.md)) |
| **Google app verification** | External apps using sensitive scopes; **plus a CASA security assessment** for restricted scopes (`gmail.readonly`, `gmail.compose`, `drive.readonly`) | unverified External apps are limited to 100 users and, while in *Testing*, their refresh tokens expire after 7 days |
| **S3-compatible object storage** | files, browser artifacts in staging/production | `OBJECT_STORAGE_BACKEND=local` is refused outside development |
| **Secret management** | JWT secret, Fernet key, API keys in production | reference: Secret Manager + External Secrets Operator |
| Kubernetes add-ons | production deployment | ingress controller, cert-manager (or other TLS), metrics-server; optional KEDA, Prometheus, OTLP collector, GKE Sandbox |
| SMTP server | e-mail notifications (optional) | in-app notifications work without it |
| Search API key (Brave or Google Programmable Search) | `search.web` (optional) | `SEARCH_PROVIDER=none` disables web search |
| ClamAV (`clamd`) | malware scanning of uploads (optional) | `MALWARE_SCANNER=none` skips scanning (development) |
| Playwright/Chromium image | browser tools (optional) | only the browser worker needs it |
| An S3-compatible image for the Compose `minio` profile | local S3 testing (optional) | upstream MinIO no longer publishes community images on Docker Hub; the default is a community build — set `MINIO_IMAGE` to one you trust |

## Known limitations (to be finalized)

> This section is completed at integration time. The items below were found while writing the
> packaging, deployment assets and documentation and are listed as input.

* **Cloud KMS is not implemented.** Only `KMS_PROVIDER=local` (Fernet keys supplied as secrets)
  works; `gcp`/`aws` refuse to start. The Terraform creates a key-encryption key for a future
  envelope-encryption implementation.
* **No re-encryption job for key rotation.** After switching `TOKEN_ENCRYPTION_KEY`, ciphertexts
  that are not rewritten naturally (refresh tokens, MFA secrets, tool/MCP credentials) stay
  under the old key until re-encrypted with `KeyManager.rotate()`; a batch job/CLI for that is
  not shipped ([operations.md](operations.md#rotate-token_encryption_key)).
* **Single JWT signing secret.** There is no key overlap, so rotating `JWT_SECRET` during a
  rolling deploy produces a few minutes of `401`s that clients recover from by refreshing.
* **Readiness depends on Redis.** `/api/v1/ready` fails when Redis is unreachable, so a Redis
  outage takes all API pods out of load balancing even though the rate limiter itself could
  fail open.
* **`.local` e-mail addresses cannot sign in.** The API's e-mail validation rejects
  special-use domains; `scripts/seed.py` therefore creates `demo@agentos.example.com` instead of
  `demo@agentos.local` while that is the case.
* **Chromium's own sandbox is off in the provided container setups** (`BROWSER_NO_SANDBOX=1`),
  because default container seccomp profiles block the user-namespace calls it needs; the
  container, the egress proxy and the network policy are the isolation boundary unless you
  install Playwright's seccomp profile or use gVisor.
* **The worker CLI's built-in default queue list** (used only when neither `--queues` nor
  `WORKER_QUEUES` is given) still includes `evaluation`; every command, manifest and
  `.env.example` in this repository passes the general list without it.
* **Evaluation needs a dedicated worker.** Evaluation runs, ACBE failure analysis and
  experiments execute only on a worker that serves the `evaluation` queue alone (one replica).
  It is optional (Compose profile / scaled to 0 in Kubernetes); without it these jobs wait.
* **No read-replica routing and no table partitioning yet.** One database engine serves all
  reads and writes; the partitioning plan for `task_events`, `usage_events` and `audit_logs`
  is in [deployment.md](deployment.md#database-partitioning-plan).
* **The user-wide SSE stream (`/events/stream`) is best effort** — no event IDs, no resume;
  the per-task stream is the resumable one.
* **PgBouncer (transaction pooling) needs configuration**: the engine sends
  `statement_timeout` as a startup parameter and asyncpg uses prepared statements.
* **Network policies are CIDR-based.** Kubernetes NetworkPolicy cannot restrict egress by DNS
  name; pinning egress to Google APIs needs an egress gateway or FQDN policies. The private
  services range and namespace names in the manifests must be adapted.
* **Infrastructure code is validated, not applied.** The Terraform passes `terraform validate`
  and mocked plans but has not been applied from CI; it assumes one environment per project.
* **Local MinIO signed URLs** point at the in-network host `minio:9000`.
* **Load tests measure what they measure.** Staged 1K/10K/100K profiles do not support
  extrapolation to much larger populations ([tests/load/README.md](../tests/load/README.md)).
