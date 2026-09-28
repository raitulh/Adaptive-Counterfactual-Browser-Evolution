# AgentOS HTTP API

* **Base path**: `/api/v1` (`API_PREFIX`). All bodies are JSON unless noted; timestamps are
  ISO-8601 with offset (UTC in responses); identifiers are UUIDv7.
* **Machine-readable schema**: `GET /api/v1/openapi.json`, interactive docs at `/docs` and
  `/redoc` (when `EXPOSE_OPENAPI=true`). `make openapi` exports it to `docs/openapi.json`.
* **Request IDs**: every response carries `X-Request-ID` (a valid client-supplied value is
  kept); error bodies repeat it as `request_id`.
* **Health**: `GET /api/v1/live` (process up), `GET /api/v1/ready` (PostgreSQL, Redis, queue
  table, migrations — `503` otherwise), `GET /api/v1/health` (dependencies + which providers
  are configured, no secrets). Prometheus metrics: `GET /metrics` (outside the prefix;
  optional bearer token `METRICS_BEARER_TOKEN`).

## Authentication

Everything except health, `register`/`login`/`refresh`, Google sign-in, the OAuth callback
and signed webhooks requires `Authorization: Bearer <access token>`.

`POST /auth/register` (201) and `POST /auth/login` return:

```json
{
  "access_token": "eyJ…",
  "token_type": "bearer",
  "expires_in": 900,
  "refresh_token": "…",
  "session_id": "01…",
  "tenant_id": "01…",
  "user_id": "01…"
}
```

* Access tokens live `ACCESS_TOKEN_TTL_SECONDS`; call `POST /auth/refresh`
  `{"refresh_token": "…"}` for a new pair. **Refresh tokens rotate on every use**; reusing an
  old one revokes the session (`401 refresh_token_reused`).
* Browser clients may send `"token_delivery": "cookie"` on login/refresh: the refresh token is
  then an `HttpOnly` cookie and refresh requires the `X-CSRF-Token` header (value of the
  `agentos_csrf` cookie).
* With MFA enabled, login needs `"mfa_code"`; without it the API answers `401 mfa_required`.
* The access token is bound to one organization (`tenant_id`); switch with
  `POST /auth/switch-organization`.
* **Server-Sent Events** cannot send headers from `EventSource`: get a short-lived token with
  `POST /auth/stream-token` and pass it as `?access_token=<stream token>`. Full access tokens
  are rejected in URLs.

## Errors

Every error uses one envelope:

```json
{"error": {"code": "validation_failed", "message": "The request is invalid.",
           "request_id": "3f9c…", "details": {"errors": [{"loc": ["body", "goal"], "msg": "…", "type": "…"}]}}}
```

| HTTP | `code` (examples) | Meaning |
|---|---|---|
| 400 | `bad_request` | malformed request |
| 401 | `unauthorized`, `invalid_credentials`, `mfa_required`, `session_invalid`, `refresh_token_reused`, `csrf_failed`, `webhook_signature_invalid` | missing/invalid credentials |
| 403 | `forbidden` (`details.missing_permissions`) | authenticated but not allowed |
| 404 | `not_found` | also returned for resources owned by someone else |
| 409 | `conflict`, `approval_not_pending`, `approval_expired`, `task_terminal`, `invalid_state_transition`, `not_waiting_for_input`, `concurrent_modification` | state conflict |
| 413 | `payload_too_large` | body over `MAX_REQUEST_BODY_BYTES` / `FILE_MAX_UPLOAD_BYTES` |
| 422 | `validation_failed`, `unsafe_url`, `idempotency_key_reused` | invalid input |
| 429 | `rate_limited`, `quota_exceeded`, `too_many_active_tasks` | rate limit or plan quota |
| 500 | `internal_error` | never includes stack traces |
| 502 / 503 | `integration_error`, `model_error`, `service_unavailable`, `configuration_missing` | upstream or configuration problem |

## Pagination

List endpoints use keyset cursors: `?limit=50&cursor=<opaque>` (default 50, maximum 200),
newest first. Responses: `{"items": […], "next_cursor": "…" | null, "has_more": true|false}`.
Task events use a sequence instead: `GET /tasks/{id}/events?after_seq=<n>&limit=100` returns
`{"items": [...], "next_after_seq": <last seq> | null}`.

## Idempotency

Create-type endpoints accept `Idempotency-Key: <8–128 chars of [A-Za-z0-9_-:.]>`:
`POST /tasks`, `POST /approvals/{id}/approve`, `POST /approvals/{id}/reject`, `POST /memory`,
`POST /files`, `POST /mcp/servers`, `POST /automations`, `POST /evaluations`,
`POST /experiments`.

* A retry with the same key and the same body returns the **stored response** with
  `Idempotent-Replayed: true` — the operation is not repeated.
* The same key with a different body → `422`; a retry while the first request is still
  running → `409`.
* 4xx outcomes are stored; on 5xx the key is released so the client can retry safely.
  Keys are scoped to the user and kept for 24 hours.

## Rate limits

Limits are per IP, user, tenant and route (see [security.md](security.md#rate-limiting)).
A limited request gets `429` with `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining: 0`
and `RateLimit-Reset` (seconds). Plan quotas (e.g. concurrent tasks, monthly tasks) also
answer `429` (`quota_exceeded` / `too_many_active_tasks`).

## Streaming task progress (SSE)

`GET /tasks/{id}/events/stream` — `text/event-stream`, authenticated with a Bearer header or
`?access_token=<stream token>`:

```
: connected

id: 20
event: APPROVAL_REQUIRED
data: {"seq": 20, "task_id": "01…", "step_id": "01…", "payload": {"approval_id": "01…", "summary": "Create calendar event …", "risk_level": "high", "expires_at": "…"}, "created_at": "…"}

: keep-alive

event: end
data: {"task_id": "01…", "status": "completed"}
```

* `id` is the event's sequence number. Reconnect with `Last-Event-ID: <seq>` (browsers do
  this automatically) to resume without gaps or duplicates — events are read from PostgreSQL,
  Redis pub/sub is only a wake-up signal.
* A `: keep-alive` comment is sent about every 15 s; `event: end` (`data: {"task_id", "status"}`)
  closes the stream once all events were delivered and the task is `completed`, `cancelled`,
  `failed` or `expired`. The last two change only through `POST /tasks/{id}/resume`; after
  resuming, reconnect with `Last-Event-ID` to continue from where the stream ended.
* If Redis is unavailable the task stream keeps working by polling the database every 2 s.
* Event types: `TASK_CREATED`, `TASK_STATE_CHANGED` (`payload.from`/`to`/`reason`),
  `PLANNING_STARTED`, `PLAN_CREATED`, `PLAN_VALIDATED`, `PLAN_REJECTED`, `TOOL_CALL_STARTED`,
  `TOOL_CALL_FINISHED`, `VERIFICATION_STARTED`, `VERIFICATION_PASSED`, `VERIFICATION_FAILED`,
  `STEP_COMPLETED`, `STEP_FAILED`, `STEP_SKIPPED`, `APPROVAL_REQUIRED`, `APPROVAL_GRANTED`,
  `APPROVAL_REJECTED`, `APPROVAL_EXPIRED`, `INPUT_REQUIRED`, `INPUT_RECEIVED`,
  `RETRY_SCHEDULED`, `RECOVERY_DECIDED`, `RECONCILIATION_REQUIRED`, `RECONCILIATION_RESOLVED`,
  `BUDGET_EXCEEDED`, `CANCEL_REQUESTED`, `TASK_PAUSED`, `TASK_RESUMED`, `TASK_COMPLETED`,
  `TASK_FAILED`, `TASK_CANCELLED`.
* `GET /events/stream` streams live notifications for all of the user's tasks
  (`event: <EVENT_TYPE>`, `data: {"type", "task_id", "seq", "event_type", "status", "step_id"}`).
  It is a best-effort hint without `id`s: on reconnect, re-read the task or its events. It
  sends a keep-alive comment every 15 s, and if Redis is unavailable it sends
  `event: stream_unavailable` with `retry: 5000` and closes.
* Behind proxies, disable response buffering and allow long reads (the Kubernetes ingress in
  `deploy/k8s/ingress.yaml` does); the API also sends `X-Accel-Buffering: no`.
* Clients that cannot use SSE poll `GET /tasks/{id}/events?after_seq=<last seen>`.

## Endpoint catalogue

Generated from the application's OpenAPI schema (paths relative to `/api/v1`). Which role
may call what is described in [security.md](security.md#authorization-rbac); `/admin/*`
additionally requires a platform administrator, `/acbe/*`, `/evaluations` and `/experiments`
require `experiments:manage` (or platform admin).

### Health

| Method | Path | Summary |
|---|---|---|
| GET | `/health` | Detailed health: dependencies and provider configuration |
| GET | `/live` | Liveness: the process is running |
| GET | `/ready` | Readiness: critical dependencies reachable (503 otherwise) |

### Auth

| Method | Path | Summary |
|---|---|---|
| POST | `/auth/login` | Sign in with e-mail and password |
| POST | `/auth/logout` | Revoke the current session |
| POST | `/auth/logout-all` | Revoke all sessions of the user |
| POST | `/auth/mfa/disable` | Disable MFA (requires a valid code) |
| POST | `/auth/mfa/enroll` | Start TOTP MFA enrollment |
| POST | `/auth/mfa/{factor_id}/confirm` | Confirm TOTP enrollment |
| GET | `/auth/oauth/google/callback` | Google sign-in callback |
| GET | `/auth/oauth/google/start` | Begin Sign in with Google |
| POST | `/auth/password/change` | Change password (revokes other sessions) |
| POST | `/auth/refresh` | Rotate the refresh token and get a new access token |
| POST | `/auth/register` | Create an account and a personal organization |
| GET | `/auth/sessions` | List the user's sessions/devices |
| DELETE | `/auth/sessions/{session_id}` | Revoke a session |
| POST | `/auth/stream-token` | Short-lived token for EventSource (SSE) connections |
| POST | `/auth/switch-organization` | Switch the active organization |

### Users

| Method | Path | Summary |
|---|---|---|
| GET | `/users/me` | Current user, active organization and permissions |
| PATCH | `/users/me` | Update profile (display name, timezone, locale) |
| DELETE | `/users/me` | Delete account (right to delete). Revokes sessions now; purges data asynchronously. |
| GET | `/users/me/organizations` | Organizations the user belongs to |

### Organizations

| Method | Path | Summary |
|---|---|---|
| POST | `/organizations` | Create an organization (caller becomes owner) |
| GET | `/organizations/current` | The active organization |
| PATCH | `/organizations/current` | Rename the active organization |
| GET | `/organizations/current/members` | List members |
| POST | `/organizations/current/members` | Add an existing user as a member |
| PATCH | `/organizations/current/members/{member_id}` | Change member role |
| DELETE | `/organizations/current/members/{member_id}` | Remove member |
| GET | `/organizations/current/policy` | Organization execution policy |
| PUT | `/organizations/current/policy` | Replace organization execution policy |

### Agents

| Method | Path | Summary |
|---|---|---|
| GET | `/agents` | List agents |
| POST | `/agents` | Create an agent with its first immutable version |
| GET | `/agents/{agent_id}` | Get an agent |
| PATCH | `/agents/{agent_id}` | Update agent metadata/status |
| DELETE | `/agents/{agent_id}` | Delete an agent (soft) |
| GET | `/agents/{agent_id}/versions` | List agent versions |
| POST | `/agents/{agent_id}/versions` | Publish a new immutable agent version (becomes current) |

### Tasks

| Method | Path | Summary |
|---|---|---|
| GET | `/tasks` | List tasks (newest first, cursor pagination) |
| POST | `/tasks` | Create a task from a natural-language goal (executed asynchronously by workers) |
| GET | `/tasks/{task_id}` | Task with plan, steps, verification evidence |
| POST | `/tasks/{task_id}/cancel` | Cancel (cooperative; stops at a safe boundary) |
| GET | `/tasks/{task_id}/events` | Ordered task events after a sequence number |
| GET | `/tasks/{task_id}/events/stream` | Server-Sent Events stream of task events (resumable) |
| POST | `/tasks/{task_id}/input` | Answer the task's pending question |
| GET | `/tasks/{task_id}/logs` | User-safe execution log |
| POST | `/tasks/{task_id}/pause` | Pause a queued/running task |
| POST | `/tasks/{task_id}/resume` | Resume a paused/blocked/expired/failed task |
| POST | `/tasks/{task_id}/steps/{step_id}/confirm` | Confirm the real-world outcome of an action that could not be verified automatically |
| GET | `/tasks/{task_id}/summary` | User-facing execution summary (what happened / changed / verified) |

### Events (user stream)

| Method | Path | Summary |
|---|---|---|
| GET | `/events/stream` | Live SSE stream of the user's task/approval/notification events |

### Approvals

| Method | Path | Summary |
|---|---|---|
| GET | `/approvals` | List approval requests (own, or all with approvals:decide_any) |
| GET | `/approvals/{approval_id}` | Get an approval request |
| POST | `/approvals/{approval_id}/approve` | Approve a pending action (re-checked at execution; single use; expires) |
| POST | `/approvals/{approval_id}/reject` | Reject a pending action |

### Tools and tool policy

| Method | Path | Summary |
|---|---|---|
| GET | `/tools` | Tool catalogue with your effective permission for each |
| POST | `/tools/connect` | Connect the account a tool provider needs (returns an OAuth authorization URL) |
| GET | `/tools/policies` | Organization tool policy rules |
| POST | `/tools/policies` | Add an organization tool rule (deny / require_approval / allow) |
| DELETE | `/tools/policies/{rule_id}` | Remove a tool rule |

### Integrations (Google)

| Method | Path | Summary |
|---|---|---|
| GET | `/integrations` | List the user's connected accounts (no tokens) |
| GET | `/integrations/google/callback` | OAuth redirect target (authenticated by the single-use state) |
| POST | `/integrations/google/connect` | Start connecting Google (Gmail/Calendar/Drive/Contacts) with least-privilege scopes |
| POST | `/integrations/{connection_id}/check` | Refresh tokens now and report connected/expired/revoked/insufficient_scope status |
| POST | `/integrations/{connection_id}/disconnect` | Disconnect and revoke the provider tokens |

### Webhooks

| Method | Path | Summary |
|---|---|---|
| POST | `/webhooks/{provider}` | Receive a signed webhook (verified, replay-protected, idempotent) |

### MCP gateway

| Method | Path | Summary |
|---|---|---|
| GET | `/mcp/servers` | List the organization's MCP servers |
| POST | `/mcp/servers` | Register an MCP server (pending admin review) |
| GET | `/mcp/servers/{server_id}` | Get one MCP server |
| DELETE | `/mcp/servers/{server_id}` | Delete an MCP server and its tools |
| POST | `/mcp/servers/{server_id}/approve` | Approve an MCP server after review (re-vets its URL) |
| POST | `/mcp/servers/{server_id}/disable` | Disable an MCP server (all of its tools become unavailable) |
| POST | `/mcp/servers/{server_id}/sync` | Discover the server's tools; changed tools are disabled until re-approved |
| GET | `/mcp/servers/{server_id}/tools` | List the tools discovered on an MCP server |
| PATCH | `/mcp/tools/{tool_id}` | Enable/disable an MCP tool or set its permission level, risk and approval requirement |

### Memory

| Method | Path | Summary |
|---|---|---|
| GET | `/memory` | List your memories (newest first, cursor-paginated) |
| POST | `/memory` | Remember something you state explicitly (deduplicated; may supersede an older value) |
| POST | `/memory/search` | Hybrid search (keyword + semantic + recency + importance) over your memories |
| DELETE | `/memory/{memory_id}` | Delete a memory and its derived data (embedding, sources) |
| POST | `/memory/{memory_id}/verify` | Re-affirm a memory (marks it fresh and trusted; resolves a conflict in its favour) |

### Files

| Method | Path | Summary |
|---|---|---|
| GET | `/files` | List your files |
| POST | `/files` | Upload a file |
| GET | `/files/download` | Download a file via a signed link (local storage backend) |
| GET | `/files/{file_id}` | Get a file's metadata |
| DELETE | `/files/{file_id}` | Delete a file and everything derived from it |
| GET | `/files/{file_id}/download-url` | Get a short-lived download URL |

### Search

| Method | Path | Summary |
|---|---|---|
| POST | `/search/documents` | Search your indexed documents (hybrid keyword + semantic) |
| POST | `/search/web` | Search the web (ranked, deduplicated, cited) |

### Automations

| Method | Path | Summary |
|---|---|---|
| GET | `/automations` | List your automations (newest first) |
| POST | `/automations` | Create a scheduled automation (runs a task on a cron schedule) |
| GET | `/automations/{automation_id}` | Get one of your automations |
| PATCH | `/automations/{automation_id}` | Update an automation (schedule, template, enabled, limits) |
| DELETE | `/automations/{automation_id}` | Delete an automation (soft delete; stops future runs) |
| POST | `/automations/{automation_id}/run-now` | Run an automation now (idempotent per minute: repeats return the same run) |
| GET | `/automations/{automation_id}/runs` | List an automation's runs (newest first) |

### Notifications

| Method | Path | Summary |
|---|---|---|
| GET | `/notifications` | List in-app notifications |
| POST | `/notifications/read-all` | Mark all as read |
| POST | `/notifications/{notification_id}/read` | Mark as read |

### Audit

| Method | Path | Summary |
|---|---|---|
| GET | `/audit` | Organization audit log (append-only) |

### Usage

| Method | Path | Summary |
|---|---|---|
| GET | `/usage` | Usage for the current month (yours, or org-wide for admins) |

### Billing

| Method | Path | Summary |
|---|---|---|
| GET | `/billing/entitlements` | Current plan and entitlements |
| GET | `/billing/plans` | Available plans |

### Evaluation

| Method | Path | Summary |
|---|---|---|
| GET | `/evaluations` | List evaluation runs |
| POST | `/evaluations` | Enqueue an evaluation run of a suite (runs on the dedicated evaluation worker) |
| GET | `/evaluations/suites` | Built-in evaluation suites and their cases |
| GET | `/evaluations/{run_id}` | Get an evaluation run with per-case results |

### Experiments

| Method | Path | Summary |
|---|---|---|
| GET | `/experiments` | List experiments |
| POST | `/experiments` | Create a controlled experiment (first variant = control) |
| GET | `/experiments/{experiment_id}` | Get an experiment with its evaluation runs |
| POST | `/experiments/{experiment_id}/decide` | Compute the winner with the statistical test and safety gates |
| POST | `/experiments/{experiment_id}/rollback` | Roll back an experiment's rollout immediately |
| POST | `/experiments/{experiment_id}/rollout` | Human rollout decision for the winner (canary, then promotion) |
| POST | `/experiments/{experiment_id}/start` | Start: enqueue an evaluation run for every variant |

### ACBE

| Method | Path | Summary |
|---|---|---|
| GET | `/acbe/candidates` | List strategy candidates |
| GET | `/acbe/candidates/{candidate_id}` | Get a strategy candidate with its experiments |
| POST | `/acbe/candidates/{candidate_id}/canary` | Approve a canary rollout of a candidate that passed evaluation |
| POST | `/acbe/candidates/{candidate_id}/evaluate` | Enqueue a baseline-vs-candidate experiment with the promotion gate |
| POST | `/acbe/candidates/{candidate_id}/promote` | Promote a canary after its observation period (failure rate must not increase) |
| POST | `/acbe/candidates/{candidate_id}/rollback` | Roll back a canary/promoted strategy immediately |
| GET | `/acbe/failures` | Verified failure patterns of this organization (fingerprint, taxonomy, significance) |

### Platform admin

| Method | Path | Summary |
|---|---|---|
| GET | `/admin/feature-flags` | Feature flag defaults and overrides |
| PUT | `/admin/feature-flags` | Create or update a flag override (global or per tenant) |
| GET | `/admin/jobs/dead` | Dead-lettered jobs |
| POST | `/admin/jobs/{job_id}/retry` | Re-queue a dead-lettered job |
| GET | `/admin/organizations` | List organizations |
| PATCH | `/admin/organizations/{org_id}` | Change plan / suspend organization |
| GET | `/admin/security-events` | Recent security events across tenants |
| GET | `/admin/system` | Workers, queue depth, dead letters, task states |
| GET | `/admin/tasks/{task_id}` | Inspect any task (audited) |
| GET | `/admin/usage` | Platform usage by tenant for the current month |
| GET | `/admin/users` | Search users |
| PATCH | `/admin/users/{user_id}` | Disable / re-enable a user (revokes sessions) |

## Example session (curl)

```bash
API=http://127.0.0.1:8000/api/v1

# 1. Register (or log in) and keep the tokens
curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Str0ng!Passw0rd","display_name":"Ada","timezone":"Asia/Dhaka"}' \
  | tee /tmp/tokens.json
TOKEN=$(jq -r .access_token /tmp/tokens.json)
REFRESH=$(jq -r .refresh_token /tmp/tokens.json)

curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Str0ng!Passw0rd"}'

# 2. Connect Google (open the returned authorization_url in a browser)
curl -s -X POST $API/integrations/google/connect -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":["calendar.read","calendar.write","gmail.send","contacts.read"]}'
curl -s $API/integrations -H "Authorization: Bearer $TOKEN"      # status: connected

# 3. Create a task (202 Accepted; executed by workers)
TASK=$(curl -s -X POST $API/tasks -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -H "Idempotency-Key: demo-$(date +%s)" \
  -d '{"goal":"Check my calendar tomorrow, find a free 30-minute slot after 2 PM, schedule a meeting with Rahim, and send him a confirmation email."}' \
  | jq -r .task_id)

# 4. Follow progress: SSE with a short-lived stream token …
STREAM=$(curl -s -X POST $API/auth/stream-token -H "Authorization: Bearer $TOKEN" | jq -r .token)
curl -N "$API/tasks/$TASK/events/stream?access_token=$STREAM"
# … or poll the ordered event log
curl -s "$API/tasks/$TASK/events?after_seq=0" -H "Authorization: Bearer $TOKEN"

# 5. Review and approve the pending action (bound to the exact arguments shown)
curl -s "$API/approvals?status=pending&task_id=$TASK" -H "Authorization: Bearer $TOKEN" \
  | jq '.items[] | {id, tool_name, summary, risk_level, arguments_preview, expires_at}'
APPROVAL=$(curl -s "$API/approvals?status=pending&task_id=$TASK" -H "Authorization: Bearer $TOKEN" | jq -r '.items[0].id')
curl -s -X POST $API/approvals/$APPROVAL/approve -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: approve-$APPROVAL" -H 'Content-Type: application/json' -d '{"note":"looks right"}'
#    (or reject: POST /approvals/$APPROVAL/reject {"reason":"wrong time"})

# 6. Task detail (plan, steps, verification evidence) and the user-facing summary
curl -s $API/tasks/$TASK -H "Authorization: Bearer $TOKEN" | jq '{status, progress, steps: [.steps[] | {step_key, status, verification_status}]}'
curl -s $API/tasks/$TASK/summary -H "Authorization: Bearer $TOKEN" | jq

# 7. Refresh the access token (the refresh token rotates: keep the new one)
curl -s -X POST $API/auth/refresh -H 'Content-Type: application/json' -d "{\"refresh_token\":\"$REFRESH\"}"
```

Other task controls: `POST /tasks/{id}/input {"answer": "…"}`,
`POST /tasks/{id}/steps/{step_id}/confirm {"outcome": "succeeded" | "did_not_happen"}`,
`POST /tasks/{id}/pause`, `/resume`, `/cancel`.
