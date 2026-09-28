# Operations runbooks

Tools you will use:

* platform admin API (requires a platform administrator — bootstrap one with
  `python -m app.cli promote-admin <email>`, which is audited):
  `GET /api/v1/admin/system` (workers and heartbeats, queue depth by status, oldest pending job
  per queue, tasks by state), `GET /api/v1/admin/jobs/dead`, `POST /api/v1/admin/jobs/{id}/retry`,
  `GET /api/v1/admin/tasks/{id}` (audited), `GET /api/v1/admin/security-events`,
  `PATCH /api/v1/admin/users/{id}` (disable + revoke sessions), `PUT /api/v1/admin/feature-flags`;
* per task: `GET /api/v1/tasks/{id}` (steps, verification evidence, reproducibility),
  `GET /tasks/{id}/events`, `GET /tasks/{id}/logs`, `GET /tasks/{id}/summary`;
* `python -m app.cli check-config` validates configuration exactly like process startup;
* metrics, logs and traces correlated by `request_id` / `trace_id` / `task_id`
  (see [deployment.md](deployment.md#observability)).

Read-only SQL is fine for diagnosis; change state through the API or the services, never by
editing task/step rows by hand (transitions, events and audit must stay consistent).

## Stuck tasks

**Symptoms**: a task stays `queued`/`running`/`planning` without new events; users report no
progress.

**Automatic recovery** — `maintenance.recover_stalled_tasks` runs every minute:
1. tasks whose latest `task.execute`/`task.plan` job was dead-lettered are failed truthfully
   (`worker_dead_letter`, owner notified);
2. execution-phase tasks with no pending/running job and no live lease for more than 2 minutes
   get a fresh `task.execute` job;
3. planning-phase tasks without a plan job for more than 5 minutes are re-planned.

A worker that died mid-step leaves the step `running`; the next driver sees it, and for a
side-effecting step reconciles against the provider (never re-runs blindly).

**Diagnose**:
1. `GET /admin/system`: are workers alive (`last_seen_seconds_ago` < 60) and serving the right
   queues? Is `oldest_pending` growing? A backlog with healthy workers means you need more
   workers (or a provider is slow — check `tool_latency_seconds` / `model_latency_seconds`).
2. `GET /admin/tasks/{id}` and `GET /tasks/{id}/events`: the last event tells you where it is.
   `waiting_*`, `blocked`, `requires_reconciliation`, `paused`, `expired` are *resting* states
   waiting for a person, not stuck.
3. Lease: `SELECT status, lease_owner, lease_expires_at, updated_at FROM tasks WHERE id = …;`
   A lease held by a dead worker expires after `JOB_LEASE_SECONDS`.
4. Jobs: `SELECT queue, job_type, status, attempts, run_at, locked_by, locked_until, last_error
   FROM jobs WHERE payload->>'task_id' = '…' ORDER BY created_at DESC;`
   A job `pending` with `run_at` in the future is a scheduled retry.
5. Evaluation/ACBE jobs pending forever: the dedicated `--queues evaluation` worker is not
   running (it is optional and scaled to 0 by default).

**Fix**: start/scale workers for the missing queue; otherwise let the owner `resume` or
`cancel` the task. Tasks with `failure_code = worker_dead_letter` can be resumed after the
underlying cause is fixed.

## Dead-lettered jobs

**Symptoms**: alert on new `dead` jobs; `jobs_processed_total{outcome="dead"}` increases.

1. `GET /admin/jobs/dead` — `job_type`, `attempts`, `last_error` (redacted, truncated),
   `tenant_id`. Correlate with logs (`job_type`, `outcome`) and traces (`job.run`).
2. Classify: bug (exception in a handler) → fix and deploy; dependency outage (DB, provider)
   → wait for recovery; bad payload (`PermanentJobFailure`) → usually no retry.
3. Re-queue after the fix: `POST /admin/jobs/{id}/retry` (resets attempts, audited). All
   handlers are idempotent, so re-running is safe; side-effecting task steps are reconciled.
4. If the job was a `task.execute`/`task.plan`, the task was already failed truthfully; ask
   the owner to resume it, or resume on their behalf through support tooling.

Dead jobs are kept 30 days (`maintenance.cleanup_jobs`), succeeded ones 7 days.

## Expired or revoked Google connections

**Symptoms**: tasks `blocked` with step `error_class = auth_expired`; users receive
`connection_expired` notifications; `GET /integrations` shows `expired` or `revoked`.

**Causes**: the user revoked access in their Google account, changed their password, an
administrator removed the app, the refresh token was unused for 6 months, or the OAuth app is
**External + Testing** (refresh tokens expire after 7 days — publish/verify the app).

**Fix**: the user reconnects (`POST /integrations/google/connect` with the same
capabilities), then `POST /tasks/{id}/resume` for each blocked task. `insufficient_scope`
means a scope was unchecked at consent — reconnect with the capability.
`POST /integrations/{id}/check` re-tests a connection on demand. Many connections expiring at
once points at the OAuth client (secret rotated, app suspended, verification status changed)
— check the Google Cloud Console.

## Approvals backlog

**Symptoms**: `approval_requests_total{outcome="expired"}` rises, `approval_wait_time_seconds`
grows, many tasks in `waiting_approval` / `expired`.

1. `GET /approvals?status=pending` (users see their own; `approvals:decide_any` sees the
   organization's). Expiry runs every minute (`maintenance.expire_approvals`); expired tasks
   need `resume`, which requests a fresh approval.
2. Check that notifications are delivered (in-app list; e-mail needs `SMTP_*`).
3. Reduce unnecessary approvals *by policy, not by code*: organization tool rules with effect
   `allow` can waive the default approval for bounded, non-destructive, untainted writes; tune
   `approval_ttl_seconds` in the organization policy (or `APPROVAL_TTL_SECONDS`).
   Destructive/financial actions, tainted arguments and high-risk actions always need approval.

## Rotate TOKEN_ENCRYPTION_KEY

`TOKEN_ENCRYPTION_KEY` encrypts OAuth tokens, MFA secrets, tool credentials and MCP auth
headers (Fernet via `MultiFernet`: the first key encrypts, every configured key decrypts).
Rotate without downtime in phases; **every process** (API, workers, evaluation worker,
browser worker, scheduler) must have the keys of a phase before the next phase starts:

1. **Distribute the new key for decryption.** Generate it
   (`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`)
   and deploy `TOKEN_ENCRYPTION_KEY=<old>`, `TOKEN_ENCRYPTION_PREVIOUS_KEYS=<new>`. Wait until
   the rollout finished everywhere.
2. **Switch the primary.** Deploy `TOKEN_ENCRYPTION_KEY=<new>`,
   `TOKEN_ENCRYPTION_PREVIOUS_KEYS=<old>`. New and refreshed secrets (e.g. every refreshed
   Google access token) are now written under the new key; old ciphertexts still decrypt.
3. **Re-encrypt old ciphertexts.** Rows not rewritten naturally (refresh tokens, MFA secrets,
   tool/MCP credentials) must be re-encrypted with `KeyManager.rotate()`
   (`app.core.crypto.get_key_manager().rotate(ciphertext)`) over
   `oauth_connections.access_token_enc`, `oauth_connections.refresh_token_enc`,
   `mfa_factors.secret_encrypted`, `tool_credentials.secret_encrypted` and
   `mcp_servers.auth_header_enc`, in small batches. This build does not ship that batch job —
   see [limitations.md](limitations.md).
4. **Retire the old key** only after step 3 is complete: deploy with
   `TOKEN_ENCRYPTION_PREVIOUS_KEYS` empty. Anything still encrypted under the old key would
   now fail to decrypt (connections show errors and must be reconnected).

**If the key leaked**: rotate as above *and* treat stored provider tokens as compromised —
disconnect (revokes at Google) and have users reconnect; rotate tool/MCP credentials at their
providers.

## Rotate JWT_SECRET

`JWT_SECRET` signs access and stream tokens only; refresh tokens are opaque database tokens.
Changing it invalidates every access token at once: clients get `401`, call
`POST /auth/refresh`, and continue with a token signed by the new secret. There is a single
active secret (no overlap), so during a rolling deploy pods with different secrets reject each
other's tokens for the few minutes the rollout takes — roll out quickly (high `maxSurge`) or
in a quiet period.

1. `python -c "import secrets; print(secrets.token_urlsafe(64))"` → new version of the
   `agentos-jwt-secret` secret.
2. Restart/roll out every process (API validates tokens; workers do not).

**If the secret leaked**, a forger could mint access tokens for any session ID it knows; each
request is still checked against the session row and the membership. Rotate immediately and,
to be safe, revoke all sessions (everyone signs in again):

```sql
BEGIN;
UPDATE auth_sessions SET revoked_at = now(), revoke_reason = 'jwt_secret_rotation' WHERE revoked_at IS NULL;
UPDATE refresh_tokens SET revoked_at = now() WHERE revoked_at IS NULL;
COMMIT;
```

## Other failure modes

| Situation | Behaviour | Action |
|---|---|---|
| Redis down | rate limiting fails open (metric `rate_limited_total{scope=~".*:redis_error"}`), SSE streams lose their wake-ups and may disconnect (clients reconnect with `Last-Event-ID` or poll `/tasks/{id}/events`), in-flight OAuth connects fail (state lost), `/ready` reports `redis: error` (pods leave load balancing) | restore Redis; users retry connecting; set `RATE_LIMIT_FAIL_OPEN=false` if you prefer rejecting traffic |
| PostgreSQL failover | requests fail briefly; workers back off; leases expire and work resumes | none; check for dead-lettered jobs afterwards |
| Model provider rate limit / outage | planning retries with backoff, then tasks fail with `model_rate_limited` / model errors | raise quota, lower concurrency, resume affected tasks |
| Google API outage | transient errors retried; persistent ones fail/block steps; writes with unknown outcome are reconciled | resume tasks after recovery |
| Scheduler not running | no automation runs, no maintenance (approvals stop expiring, no retention) | alert on missing `maintenance.*` jobs; restart it |

## Incident checklist

1. **Detect & declare** — open an incident, assign a lead, start a timeline (UTC).
2. **Scope** — which tenants, users, tasks, integrations? Use audit logs
   (`GET /audit`, `GET /admin/security-events`), task events and traces by `request_id`.
3. **Contain** — kill switches, from narrow to broad:

   | Lever | Effect |
   |---|---|
   | organization policy `blocked_tools` / tool rule `deny` | stops a tool for one organization at the next permission check |
   | `POST /mcp/servers/{id}/disable` | removes a server's tools immediately |
   | feature flags `browser_agent_enabled`, `mcp_enabled`, `web_search_enabled`, `acbe_enabled` (`PUT /admin/feature-flags`, global or per tenant) | disables a whole capability |
   | `POST /acbe/candidates/{id}/rollback` | reverts a learned strategy |
   | `PATCH /admin/users/{id}` `disabled` | blocks a user, revokes sessions; their tasks fail with `principal_revoked` |
   | scale workers to 0 | freezes all execution; tasks resume from durable state when workers return |
   | rotate `JWT_SECRET` / revoke sessions | forces re-authentication |
4. **Preserve evidence** — the audit log is append-only; export relevant logs/traces before
   retention removes them; do not delete tasks or events.
5. **Eradicate & recover** — fix, deploy, re-queue dead jobs, resume tasks, reconnect
   integrations, rotate exposed credentials (see above).
6. **Verify** — no pending `external_actions` left unexplained; affected tasks either
   completed (verified) or honestly failed.
7. **Communicate** — notify affected organizations; for personal-data breaches observe
   regulatory deadlines (e.g. GDPR: 72 hours to the supervisory authority).
8. **Post-incident review** — blameless write-up, action items, regression test (an evaluation
   case or an end-to-end test) for the failure mode.
