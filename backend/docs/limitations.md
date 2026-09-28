# Limitations and external prerequisites

AgentOS is honest about what it verified; this page is honest about what it needs from the
outside world and where it is incomplete.

## External prerequisites

These are not bugs — the platform cannot work (fully) without them:

| Prerequisite | Needed for | Notes |
|---|---|---|
| **PostgreSQL 16 with pgvector** | everything | the migration role must be allowed to `CREATE EXTENSION vector`, or a superuser must create it first (managed PostgreSQL: enable pgvector) |
| **Redis 7** | rate limiting, OAuth state, locks, SSE wake-ups | transient data only; `/api/v1/ready` reports it as `degraded` when down (a readiness failure only with `READINESS_REQUIRES_REDIS=true`) |
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

## Known limitations

None of these affect the safety invariants (no unapproved high-risk action, no completion
without verification, no cross-tenant access); they are gaps in reach, scale or operations.

**Verified against simulators, not live providers.** The acceptance scenario and every failure
scenario run end to end through the real API, planner, validator, permission engine,
approvals, execution engine, adapters and verifiers — but against a faithful Google Workspace
simulator and scripted model responses. This build was not exercised against live Google APIs
or live Gemini (that needs your OAuth client, consented accounts and an API key). Plan quality
with the real model is measured by the evaluation suites once `GEMINI_API_KEY` is set
(`model_mode="configured"` cases).

**Security / keys**

* **Cloud KMS is not implemented.** Only `KMS_PROVIDER=local` (Fernet keys supplied as secrets)
  works; `gcp`/`aws` refuse to start rather than fall back. The Terraform creates a
  key-encryption key for a future envelope-encryption implementation. Key rotation itself is
  complete: `MultiFernet` decryption with previous keys plus `python -m app.cli rotate-encryption`
  ([operations.md](operations.md#rotate-token_encryption_key)); JWT secrets rotate with
  `JWT_PREVIOUS_SECRETS`.
* **Chromium's own sandbox is off in the provided container setups** (`BROWSER_NO_SANDBOX=1`),
  because default container seccomp profiles block the user-namespace calls it needs; the
  container, the per-task egress proxy and the network policy are the isolation boundary unless
  you install Playwright's seccomp profile or use gVisor. Run browser workers in their own
  node pool / network namespace.
* **Network policies are CIDR-based.** Kubernetes NetworkPolicy cannot restrict egress by DNS
  name; pinning egress to Google APIs needs an egress gateway or FQDN policies. The private
  services range and namespace names in the manifests must be adapted.

**Integrations and product scope**

* **Built-in integrations are Google Workspace only** (Gmail, Calendar, Drive, Contacts) plus
  web search, files, memory and the browser. Other SaaS tools are added through the MCP gateway
  (registered per organization, approved by an admin, sandboxed by the same egress policy).
* **Google restricted scopes need verification.** Production use of `gmail.readonly`,
  `gmail.compose` and `drive.readonly` requires Google's app verification and a CASA assessment
  (see the prerequisites table).
* **Billing has no payment processor** (`BILLING_PROVIDER=none`): plans, quotas and usage
  metering are enforced, but charging customers needs a provider integration.
* **E-mail reconciliation depends on search consistency.** An e-mail whose send timed out is
  found by its deterministic `Message-ID` through Gmail search. An empty result within 120 s of
  the attempt is not trusted (the step waits and re-checks); only a second empty lookup allows
  the single retry. Search lag beyond that window could still cause one duplicate e-mail —
  raise `reconcile_settle_seconds` on `gmail.send` if your tenants see slower indexing.

**Evaluation / ACBE**

* **Evaluation needs a dedicated worker.** Evaluation runs, ACBE failure analysis and
  experiments execute only on a worker that serves the `evaluation` queue alone (one replica).
  It is optional (Compose profile `evaluation`; `replicas: 0` in Kubernetes); without it these
  jobs wait in the queue.
* **No browser simulator in the evaluation suites.** Browser tools are covered by their own
  test suite (local pages behind the real egress proxy) but not by evaluation cases.
* **Evaluation tenants leave audit rows behind.** Evaluation runs in throw-away tenants that are
  deleted afterwards, but their audit entries remain because `audit_logs` is append-only by
  design (a database trigger); retention purges remove them on schedule.

**Scale and operations**

* **No read-replica routing and no table partitioning yet.** One database engine serves all
  reads and writes; the partitioning plan for `task_events`, `usage_events` and `audit_logs`
  is in [deployment.md](deployment.md#database-partitioning-plan).
* **The user-wide SSE stream (`/events/stream`) is best effort** — no event IDs, no resume; on
  a Redis outage it sends `stream_unavailable` and closes. The per-task stream is the resumable
  one (and falls back to database polling when Redis is down).
* **PgBouncer (transaction pooling) needs configuration**: the engine sends
  `statement_timeout` as a startup parameter and asyncpg uses prepared statements.
* **Container images were not built in the development environment** (no Docker daemon there).
  The Dockerfiles are linted (hadolint) and their build/install steps were reproduced outside
  Docker (wheels, offline install, entry points, migrations, tool sync, seed); Compose
  configuration validates for every profile and the Kubernetes manifests pass strict schema
  validation. Build the images in CI before the first deployment.
* **Infrastructure code is validated, not applied.** The Terraform passes `terraform validate`
  and mocked plans but has not been applied from CI; it assumes one environment per project.
* **Local MinIO signed URLs** point at the in-network host `minio:9000`.
* **Load tests measure what they measure.** Staged 1K/10K/100K profiles do not support
  extrapolation to much larger populations ([tests/load/README.md](../tests/load/README.md)).
