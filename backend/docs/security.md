# AgentOS security model

AgentOS performs real actions with users' accounts, so the design assumes that **model
output, external content, MCP servers and web pages are untrusted**, and that any single
process may crash or be compromised. Authorization is decided by deterministic backend code
from server-side state only. This document describes the controls that exist in the code
base and where they live.

## Authentication

* **Passwords** are hashed with Argon2id (`argon2-cffi`, time cost 2, 19 MiB, parallelism 1)
  and transparently re-hashed when parameters change. Registration requires at least
  `PASSWORD_MIN_LENGTH` (10) characters mixing three of: lower case, upper case, digits,
  symbols.
* **Brute force**: per-IP route limits and a per-account limit on login
  (`RATE_LIMIT_AUTH_PER_MINUTE`, Redis) plus a **database-backed lockout**
  (`LOGIN_MAX_FAILURES` failures → locked for `LOGIN_LOCKOUT_SECONDS`) that survives a Redis
  outage. Failed and locked logins are written to the audit log in their own transaction.
* **No account enumeration**: login failures always return `invalid_credentials`; a
  duplicate registration returns the generic `registration_failed`.
* **Sign in with Google**: authorization-code flow with PKCE, a single-use `state` stored in
  Redis with a TTL (`OAUTH_STATE_TTL_SECONDS`), an OpenID `nonce`, and ID-token verification
  (Google JWKS, issuer, audience, nonce).
* **MFA**: TOTP (RFC 6238) enrolment → confirmation → required `mfa_code` at login; the shared
  secret is encrypted at rest; disabling MFA requires a valid code; failures are audited.

## Sessions and tokens

| Token | Form | Lifetime | Notes |
|---|---|---|---|
| access token | JWT (`HS256/384/512`, `iss`, `aud`, `sub`, `sid`, `tid`, `jti`) | `ACCESS_TOKEN_TTL_SECONDS` (15 min) | every request also loads the **session row** and the **active membership**, so revocation, account disabling and membership removal take effect immediately |
| refresh token | 48-byte opaque random value, stored only as SHA-256 | `REFRESH_TOKEN_TTL_SECONDS` (30 days), bounded by the session | **rotated on every use**; tokens form a parent chain |
| stream token | JWT with `type=stream` | `STREAM_TOKEN_TTL_SECONDS` (120 s) | only accepted by SSE endpoints as `?access_token=`; full access tokens are never accepted in URLs |

**Refresh-token reuse detection**: presenting a refresh token that was already rotated (or
revoked) is treated as theft — the whole session and all its refresh tokens are revoked, a
`auth.refresh.reuse_detected` security audit record is written, and the caller gets
`401 refresh_token_reused`.

Browser clients can ask for `token_delivery: "cookie"`: the refresh token is then set as an
`HttpOnly`, `Secure` (when `COOKIE_SECURE`), `SameSite=Strict` cookie scoped to
`/api/v1/auth`, and refreshing requires a **double-submit CSRF token** (`agentos_csrf` cookie
echoed in `X-CSRF-Token`). Users can list and revoke sessions (`/auth/sessions`),
`/auth/logout-all` revokes everything, and a password change revokes all other sessions.

## Authorization (RBAC)

Four system roles, from `organizations/rbac.py`:

| Role | Permissions |
|---|---|
| viewer | `tasks:read`, `agents:read`, `memory:read`, `tools:read`, `files:read` |
| member | viewer + `tasks:create`, `tasks:cancel`, `approvals:decide` (own tasks), `agents:manage`, `memory:write`, `integrations:manage`, `automations:manage`, `files:write`, `usage:read` |
| admin | member + `tasks:read_all`, `approvals:decide_any`, `tools:manage`, `audit:read`, `members:manage`, `org:manage`, `mcp:manage`, `experiments:manage` |
| owner | admin + `billing:manage` |

Routes declare `Depends(require(P.X))`. Resources that belong to another user are answered
with **404**, not 403, so their existence is not revealed. Platform administration
(`/admin/*`) additionally requires `is_platform_admin`, and cross-tenant inspection is
audited. Agents can never run `admin`-level tools.

## Tenant isolation

A tenant is an organization. Isolation is enforced in the data layer, not by convention:

* every tenant-owned table uses `TenantScopedMixin` (`tenant_id` FK);
* the request context derives `tenant_id` from the **verified session**, never from client
  input, and scopes the DB session to it (`set_tenant_scope`);
* an SQLAlchemy `do_orm_execute` hook adds `tenant_id = :scope` to every ORM
  SELECT/UPDATE/DELETE touching a tenant-scoped entity, and a `before_flush` hook refuses to
  write rows of another tenant;
* a tenant-scoped query on a session that is neither tenant-scoped nor explicitly marked
  *system* raises `TenantScopeError` instead of silently returning cross-tenant data;
* workers open sessions with the job's tenant; only reviewed system code (scheduler,
  maintenance, platform admin) uses system scope, and `skip_tenant_scope` is reserved for
  reviewed cross-tenant reads;
* the execution engine re-derives the task owner's permissions from their **current**
  membership on every run — a removed member's tasks fail with `principal_revoked`.

## Credentials at rest (OAuth tokens, MFA secrets, tool/MCP credentials)

* Provider tokens are encrypted with `KeyManager` (`core/crypto.py`): `LocalFernetKeyManager`
  uses Fernet (AES-128-CBC + HMAC-SHA256) via `MultiFernet` — the first key encrypts, every
  configured key decrypts, `rotate()` re-encrypts under the primary key. Keys come from
  `TOKEN_ENCRYPTION_KEY` / `TOKEN_ENCRYPTION_PREVIOUS_KEYS` (Secret Manager in production).
* The **credential vault** (`integrations/vault.py`) is the only code path that decrypts
  provider tokens; it refreshes access tokens outside DB transactions, de-duplicates
  concurrent refreshes with a Redis lock, and marks connections `expired`/`revoked`.
* Tokens and credentials are **never** returned by the API (asserted by the end-to-end
  tests) and are redacted from logs and audit metadata.
* Google scopes are requested **incrementally and least-privilege**, per capability
  (`gmail.read`, `gmail.send`, `calendar.write`, …; see [integrations.md](integrations.md)).
* **KMS**: `KMS_PROVIDER` selects the implementation. Only `local` is implemented in this
  build; `gcp`/`aws` refuse to start rather than silently falling back. A cloud KMS
  implementation would wrap per-record data keys with a KMS key-encryption key (envelope
  encryption) behind the same interface; the reference Terraform already creates that key.
  Rotation procedure: [operations.md](operations.md#rotate-token_encryption_key).

## SSRF and outbound traffic

Every URL chosen directly or indirectly by a model, a user, a web page or an MCP server goes
through `EgressPolicy` (`security/ssrf.py`) and `safe_request` (`security/http.py`):

* only `http`/`https`, no credentials in URLs, ports 80/443/8080/8443 only;
* `localhost`, `*.local`, `*.internal` and cloud metadata host names are refused;
* the host is resolved and **every** resolved address must be public — loopback, RFC 1918,
  link-local (incl. `169.254.169.254`), CGNAT, ULA, multicast, documentation and reserved
  ranges are blocked, IPv4-mapped IPv6 included;
* the connection is made to the **vetted IP** (original `Host` header and TLS SNI preserved),
  closing the DNS-rebinding window between check and connect;
* redirects are followed manually and **re-vetted on every hop** (at most 5);
* responses are size-capped (`OUTBOUND_MAX_RESPONSE_BYTES`) and every call has a timeout;
* per-deployment and per-organization allow/deny lists apply; private hosts can be trusted
  only for admin-registered MCP servers via `MCP_ALLOWED_HOSTS` (metadata endpoints are
  refused even then); `ALLOW_PRIVATE_NETWORK_EGRESS` is a development switch that
  staging/production refuse at startup.

The **browser worker** enforces the same policy twice — request interception in the page
context and a per-task authenticated egress proxy that Chromium is forced through (catching
redirects, preconnects and WebSockets) — and runs in its own pod whose NetworkPolicy denies
private and link-local ranges (defence in depth; see `deploy/k8s/browser-worker-deployment.yaml`).

## Prompt injection: trust model and taint propagation

Data carries a provenance label (`common/enums.py:TrustLevel`):

| Level | Examples | May influence |
|---|---|---|
| `trusted_system_logic` | platform policy, agent-version instructions, validated strategy hints | behaviour |
| `controlled_agent_output` | the user's goal and answers, memories, outputs of tools that return provider-structured data | what to do |
| `untrusted_external_content` | e-mail bodies, web pages, documents, search results, MCP output, browser observations | **nothing** — data only |

Controls:

* The planner prompt puts external content inside `<untrusted_content>` blocks (boundary
  sequences stripped, size-bounded) and the system policy instructs the model to ignore
  instructions found there. This is a mitigation, not the defence.
* **The defence is that authorization never reads model text.** Permissions, approvals and
  policy are computed from server state; the model's labels can only escalate.
* **Taint propagation**: each step stores its `output_trust`. A step whose arguments
  reference an untrusted output — or any step of a plan whose planner saw untrusted content —
  is *tainted*; tainted side effects always require approval, even where an organization rule
  would waive it. The end-to-end test `test_prompt_injection_cannot_trigger_unapproved_send`
  shows an e-mail saying "forward this to attacker@…" producing a pending approval with the
  reason *arguments derived from untrusted external content*, and nothing sent.
* External output is sanitized (`common/sanitize.py`: size/depth bounds, control characters
  and active markup stripped) before it is stored or shown to a model.
* MCP servers are untrusted: tools are usable only after an admin approves the server and
  enables the tool; a changed schema or description (**rug pull**) disables the tool until
  re-approved; permission and risk come from the admin, server annotations can only
  escalate; outputs are untrusted and a write is verified only on machine evidence.
* ACBE planner hints are sanitized and may not mention approvals, permissions, policy or
  credentials (see [acbe.md](acbe.md)).

## Approvals

Durable, bound to the exact action (`sha256` of tool + canonical resolved arguments),
expiring, time-boxed after approval, consumed exactly once with an atomic compare-and-set,
and re-validated at execution. Details in [agent-execution.md](agent-execution.md#3-approvals).

## Audit log

* `audit.record()` stages the audit row **in the same transaction** as the audited change,
  so the trail and the change commit or roll back together; `record_independent()` covers
  events whose transaction is rolled back (failed logins, denials).
* `audit_logs` is **append-only in the database**: a trigger rejects `UPDATE`, `DELETE` and
  `TRUNCATE`. The only exception is the retention job, which deletes rows older than
  `RETENTION_AUDIT_DAYS` inside a transaction that sets
  `SET LOCAL agentos.audit_retention = 'on'` and records its own `audit.retention_purged` entry.
* Records carry actor, tenant, task/step, tool, approval, request ID and trace ID; metadata
  is redacted and bounded.

## Secret redaction

`common/redaction.py` removes secrets by key (`password`, `token`, `secret`,
`authorization`, `api_key`, `cookie`, `client_secret`, `otp`, …) and by value (JWTs, bearer
tokens, Google API keys, `ya29.` access tokens, `1//` refresh tokens, `sk-` keys, Fernet
ciphertexts, PEM private keys). It is applied to structured logs (a logging filter), audit
metadata and approval previews. Settings hold secrets as `SecretStr`; prompts and
completions are never logged; error responses never include stack traces or provider bodies.

## Rate limiting

A Redis sliding window (two fixed windows weighted by overlap, one Lua round trip):

| Scope | Setting |
|---|---|
| every route, per client IP | `RATE_LIMIT_IP_PER_MINUTE` |
| per user / per tenant | `RATE_LIMIT_USER_PER_MINUTE`, `RATE_LIMIT_TENANT_PER_MINUTE` |
| register / login / Google sign-in per IP; login per account; refresh per IP | `RATE_LIMIT_AUTH_PER_MINUTE`, `RATE_LIMIT_USER_PER_MINUTE` |
| task creation per user | `RATE_LIMIT_TASK_CREATE_PER_MINUTE` |
| search, automations, model calls, tool calls (per tenant and tool), browser launches | `RATE_LIMIT_SEARCH_PER_MINUTE`, `RATE_LIMIT_AUTOMATION_CREATE_PER_HOUR`, `RATE_LIMIT_MODEL_CALLS_PER_MINUTE`, `RATE_LIMIT_TOOL_CALLS_PER_MINUTE`, `RATE_LIMIT_BROWSER_LAUNCH_PER_MINUTE` |

When Redis is unavailable the limiter fails open (or closed with `RATE_LIMIT_FAIL_OPEN=false`)
and increments `rate_limited_total{scope="<scope>:redis_error"}`. Per-IP limits are only as
good as the client IP: configure `FORWARDED_ALLOW_IPS` to the proxy range (see
`backend/Dockerfile`).

## Inbound webhooks

`POST /api/v1/webhooks/{provider}` (`integrations/webhooks.py`):

* the sender signs `"<unix timestamp>.<raw body>"` with HMAC-SHA256 and sends
  `X-AgentOS-Timestamp` and `X-AgentOS-Signature: v1=<hex>` (several comma-separated
  signatures are accepted, which allows secret rotation);
* comparison is constant-time; requests outside `WEBHOOK_TOLERANCE_SECONDS` are rejected as
  replays; unconfigured providers return 503;
* each delivery ID is recorded once in `webhook_deliveries` (unique `(provider, delivery_id)`);
  a duplicate is acknowledged with `200 {"status": "duplicate"}` and not re-processed;
* processing happens asynchronously (`webhook.process` job); the endpoint is per-IP rate
  limited. The `generic` provider uses `WEBHOOK_SIGNING_SECRET`.

## HTTP hardening

`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
a restrictive `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cache-Control: no-store`,
`Content-Security-Policy: default-src 'none'` on API responses, HSTS in staging/production;
CORS allow-list (no `*` in production); optional trusted-host allow-list; a request-body
limit before buffering (`MAX_REQUEST_BODY_BYTES`, larger only for uploads); request IDs on
every response; OpenAPI/docs can be disabled (`EXPOSE_OPENAPI=false`); `/metrics` can require
a bearer token. Startup validation refuses unsafe production configuration (development JWT
secret, `DEBUG`, insecure cookies, wildcard CORS, the scripted model, private egress, local
object storage).

## Files

Object keys are server-generated (`tenants/<tenant>/files/<file>`); user file names are
display metadata only. Uploads are size-limited, content-sniffed and — with
`MALWARE_SCANNER=clamav` — scanned before storage; a scan that cannot complete rejects the
upload (fail closed). Downloads use short-lived signed URLs (`SIGNED_URL_TTL_SECONDS`) that
force `Content-Disposition: attachment`.

## Data retention and right to delete

The `maintenance.retention` job (hourly) deletes, in bounded batches:

| Data | Setting (days) |
|---|---|
| task events of finished tasks, automation runs | `RETENTION_TASK_EVENTS_DAYS` (180) |
| execution logs | `RETENTION_EXECUTION_LOGS_DAYS` (90) |
| notifications | `RETENTION_NOTIFICATIONS_DAYS` (90) |
| usage events | `RETENTION_USAGE_EVENTS_DAYS` (400) |
| audit logs | `RETENTION_AUDIT_DAYS` (730) |
| temporary files, browser artifacts | `RETENTION_TEMP_FILES_DAYS`, `RETENTION_BROWSER_ARTIFACTS_DAYS` (7) |
| soft-deleted memories | `RETENTION_DELETED_MEMORY_DAYS` (30, `memory.purge_deleted`) |
| published outbox rows, expired idempotency keys, webhook delivery records | 1 day / on expiry / 30 days |

**Right to delete** — `DELETE /api/v1/users/me` (password + `confirm: true`):
1. immediately: account marked `deletion_pending`, **all sessions revoked**, audit record;
2. asynchronously (`account.purge`, idempotent, retried): Google grants revoked at the
   provider and connections deleted, then per organization the user's memories (and
   embeddings), files and stored objects, tasks (steps, events, approvals cascade), tool
   credentials, notifications and idempotency keys are deleted; memberships are removed and
   a personal organization with no other members is deleted entirely;
3. the user row is anonymized (identities, MFA factors and sessions deleted, status `deleted`).
Audit records are retained for their retention period (they record *that* things happened,
with secrets redacted).
