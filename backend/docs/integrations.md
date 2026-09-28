# Integrations: Google, MCP servers and the browser worker

## Google (Gmail, Calendar, Drive, Contacts, Sign in with Google)

AgentOS uses one Google OAuth *web application* client for two flows:

| Flow | Start | Redirect URI setting | Scopes |
|---|---|---|---|
| Sign in with Google | `GET /api/v1/auth/oauth/google/start` | `GOOGLE_LOGIN_REDIRECT_URI` | `openid email profile` |
| Connect an account for tools | `POST /api/v1/integrations/google/connect` | `GOOGLE_REDIRECT_URI` | per capability (below), requested incrementally |

Both use the authorization-code flow with **PKCE** and a single-use `state` (Redis, TTL
`OAUTH_STATE_TTL_SECONDS`); sign-in also verifies the ID token and nonce. Connection tokens
are stored encrypted and never returned by the API.

### 1. Google Cloud project and APIs

1. In the [Google Cloud Console](https://console.cloud.google.com/) create or select a project.
2. *APIs & Services → Library*: enable the APIs for the capabilities you will offer —
   **Gmail API**, **Google Calendar API**, **Google Drive API**, **People API** (contact lookup).

### 2. OAuth consent screen (Google Auth Platform)

1. *Google Auth Platform → Branding*: app name, user support e-mail, logo, application home
   page, privacy policy and terms URLs, **authorized domains** (the domain of your API and
   frontend, e.g. `example.com`), developer contact e-mail.
2. *Audience*: **Internal** (only users of your Google Workspace organization — no
   verification needed) or **External**. External apps start in **Testing**: only listed
   test users (max. 100) can consent, and refresh tokens issued in Testing **expire after
   7 days** — connections then show `expired` and tasks block until the user reconnects.
3. *Data access*: add the scopes you will request (table below). Only add what you use: every
   sensitive or restricted scope affects verification.

### 3. OAuth client

*Google Auth Platform → Clients → Create client → Web application*:

* **Authorized redirect URIs** — both, exactly (scheme, host, port, path, no trailing slash):
  * `http://localhost:8000/api/v1/integrations/google/callback`
  * `http://localhost:8000/api/v1/auth/oauth/google/callback`
  * production: `https://api.example.com/api/v1/integrations/google/callback` and
    `https://api.example.com/api/v1/auth/oauth/google/callback`
* Authorized JavaScript origins are not needed (the code exchange happens on the server).

Configure the backend:

```bash
GOOGLE_CLIENT_ID=<client id>.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<client secret>            # a secret: Secret Manager in production
GOOGLE_REDIRECT_URI=https://api.example.com/api/v1/integrations/google/callback
GOOGLE_LOGIN_REDIRECT_URI=https://api.example.com/api/v1/auth/oauth/google/callback
FRONTEND_OAUTH_SUCCESS_URL=https://app.example.com/integrations?status=connected
FRONTEND_OAUTH_ERROR_URL=https://app.example.com/integrations?status=error
```

`GET /api/v1/health` reports `providers.google_oauth.configured`.

### 4. Scopes per capability

Capabilities are least-privilege bundles; request only what the user needs, when they need
it (`POST /integrations/google/connect {"capabilities": [...]}` or `POST /tools/connect`).
Broader grants satisfy narrower requirements (e.g. `calendar.events` covers
`calendar.readonly`).

| Capability | Scope | Tools | Google classification* |
|---|---|---|---|
| `calendar.read` | `…/auth/calendar.readonly` | `calendar.list_events`, `calendar.find_free_slots` | sensitive |
| `calendar.write` | `…/auth/calendar.events` | `calendar.create_event`, `calendar.update_event`, `calendar.cancel_event` | sensitive |
| `gmail.send` | `…/auth/gmail.send` | `gmail.send` | sensitive |
| `gmail.read` | `…/auth/gmail.readonly` | `gmail.search`, `gmail.read_message` (and reconciliation lookups) | **restricted** |
| `gmail.compose` | `…/auth/gmail.compose` | `gmail.create_draft` | **restricted** |
| `contacts.read` | `…/auth/contacts.readonly` | `contacts.lookup` | sensitive |
| `drive.read` | `…/auth/drive.readonly` | `drive.search`, `drive.read_file` | **restricted** |
| `drive.file` | `…/auth/drive.file` | files the user opened/created with the app | non-sensitive |
| (sign-in) | `openid`, `email`, `profile` | — | non-sensitive |

\* As classified by Google at the time of writing — check the current
[OAuth scope list](https://developers.google.com/identity/protocols/oauth2/scopes) before
submitting for verification.

The default connect request asks for `calendar.read`, `calendar.write`, `gmail.send` and
`contacts.read` (no restricted scope). Note that `gmail.send` reconciliation after an
ambiguous timeout searches the mailbox for the deterministic `Message-ID`, which needs
`gmail.readonly`; without it an unknown outcome is escalated to the user instead of being
resolved automatically.

### 5. Verification requirements (External apps)

* **Sensitive scopes** (Calendar, `gmail.send`, contacts): Google **app verification** —
  verified domain ownership (Search Console) for the home page and redirect domains, a public
  privacy policy describing the data use, a justification per scope and a demo video of the
  consent flow and the feature using each scope. Until verified, users see an "unverified
  app" warning and the app is capped at 100 users.
* **Restricted scopes** (`gmail.readonly`, `gmail.compose`, `drive.readonly`): everything
  above **plus** an annual third-party **security assessment** (CASA) and compliance with the
  Google API Services User Data Policy, including the **Limited Use** requirements (no
  transfer or use of Gmail/Drive data beyond providing the user-facing feature, no use for
  advertising, human access only with consent or for security/legal reasons).
* **Internal** apps of a Google Workspace organization are exempt from verification.

Plan for weeks, not days; offer restricted capabilities only after verification.

### 6. Connecting and operating connections

```bash
curl -s -X POST $API/integrations/google/connect -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"capabilities":["calendar.read","calendar.write"]}'
# → {"authorization_url": "https://accounts.google.com/o/oauth2/v2/auth?...", "requested_scopes": [...]}
```

Open `authorization_url` in the user's browser; Google redirects to the callback, the backend
exchanges the code (PKCE), stores the encrypted tokens and the **granted** scopes, and
redirects the browser to `FRONTEND_OAUTH_SUCCESS_URL` (or `…ERROR_URL&reason=<code>`).

| Endpoint | Purpose |
|---|---|
| `GET /integrations` | connections with `status`, granted `scopes`, `capabilities`, token expiry — never tokens |
| `POST /integrations/{id}/check` | refresh now and report `connected` / `expired` / `revoked` / `insufficient_scope` |
| `POST /integrations/{id}/disconnect` | revoke at Google and mark disconnected |

Access tokens are refreshed automatically (90 s before expiry, de-duplicated across workers).
When Google rejects a refresh (revoked, password change, Testing-mode expiry) the connection
becomes `expired`/`revoked`, the user gets a `connection_expired` notification, and tasks
that need it move to `blocked`; after reconnecting, `POST /tasks/{id}/resume` continues them.
A tool that lacks a scope blocks with `permission_denied` before any side effect.

| Symptom | Cause |
|---|---|
| `redirect_uri_mismatch` at Google | the URI in `GOOGLE_*REDIRECT_URI` is not registered exactly |
| `access_denied` | the user declined, or is not a test user of an app in Testing |
| connections expire weekly | External app still in Testing |
| `insufficient_scope` | the user unchecked a scope on the consent screen; reconnect with the capability |

## MCP servers

The MCP gateway lets an organization add tools from remote MCP servers without giving those
servers any authority:

* only the **Streamable HTTP** transport is supported (stdio would mean running
  tenant-chosen processes on AgentOS workers);
* server URLs pass the SSRF policy at registration, approval and on every call (connections
  are pinned to the vetted IP); private hosts only when listed in `MCP_ALLOWED_HOSTS`, cloud
  metadata never;
* a server is usable only after an admin **approves** it; discovered tools are usable only
  after an admin **enables** them and sets their permission level, risk and approval
  requirement; server annotations are advisory and can only escalate;
* **rug-pull protection**: if a later sync sees a changed schema or description, the tool is
  disabled until re-approved;
* credentials (the auth header value) are write-only and encrypted; outputs are untrusted
  content; writes are verified only on machine evidence (declared `outputSchema` + valid
  `structuredContent`), otherwise the user is asked;
* the `mcp_enabled` feature flag and `MCP_ENABLED` switch the gateway off; calls are
  rate-limited per server and time out after `MCP_CALL_TIMEOUT_SECONDS`.

Registering needs `mcp:manage` (admin/owner); listing needs `tools:read`. Tools appear in the
catalogue as `mcp.<server>.<tool>`.

### Walkthrough with the demo server

`scripts/demo_mcp_server.py` is a small, real MCP server (FastAPI + uvicorn only) exposing
`echo` (read-only) and `add_note` (a write with an `outputSchema`, so it can be verified).

```bash
# 1. run it (binds 127.0.0.1; --token enables bearer auth; --response-mode sse is optional)
.venv/bin/python scripts/demo_mcp_server.py --port 8765 --token demo-secret-token

# 2. allow the private host for this development deployment, then restart API and workers
echo 'MCP_ALLOWED_HOSTS=127.0.0.1' >> .env

# 3. register (pending_review)
SERVER=$(curl -s -X POST $API/mcp/servers -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: mcp-demo-1" \
  -d '{"name":"demo","url":"http://127.0.0.1:8765/mcp","auth_header_value":"Bearer demo-secret-token"}' | jq -r .id)

# 4. approve (re-vets the URL) and 5. discover tools
curl -s -X POST $API/mcp/servers/$SERVER/approve -H "Authorization: Bearer $TOKEN"
curl -s -X POST $API/mcp/servers/$SERVER/sync -H "Authorization: Bearer $TOKEN" | jq '{added, schema_changed, rejected}'

# 6. enable the tools you want, deciding their permission level / risk / approval
curl -s $API/mcp/servers/$SERVER/tools -H "Authorization: Bearer $TOKEN" | jq '.[] | {id, qualified_name, usable}'
curl -s -X PATCH $API/mcp/tools/<echo tool id> -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled": true, "permission_level": "read", "risk_level": "low"}'
curl -s -X PATCH $API/mcp/tools/<add_note tool id> -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"enabled": true, "permission_level": "write", "risk_level": "medium", "requires_approval": true}'

# 7. the tools are now in the catalogue (with your effective permission) and plannable
curl -s $API/tools -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.name | startswith("mcp.")) | {name, requires_approval, available_to_you}'
```

With Docker Compose the API and workers run in containers, where `127.0.0.1` is the
container itself: run the demo server so that it is reachable from the Compose network (for
example as an extra service on the same network, registered by its service name, which must
then be listed in `MCP_ALLOWED_HOSTS`). Re-run `/sync` after the server changes; changed tools
come back disabled (`schema_changed`) until you enable them again. `POST /mcp/servers/{id}/disable`
or `DELETE` removes a server's tools from all future plans immediately.

## Browser worker

Browser tools — `browser.navigate`, `browser.extract`, `browser.screenshot`, `browser.click`,
`browser.fill`, `browser.run` — never run Chromium in the API or general workers. A tool call
validates the request (action budget, egress policy, feature flag `browser_agent_enabled`,
per-tenant launch rate limit `RATE_LIMIT_BROWSER_LAUNCH_PER_MINUTE`), stores a
`browser_tasks` row, enqueues it on the `browser` queue and leaves the step
`waiting_external`. The browser worker runs it in a fresh, non-persistent context (no cookies
or storage carried over), forced through a per-task egress proxy, with per-action and total
timeouts, and reports sanitized observations back; the engine then verifies them
(side-effecting browser actions pass only with concrete evidence such as an expected URL or
text).

Settings: `BROWSER_ENABLED`, `BROWSER_HEADLESS`, `BROWSER_MAX_CONCURRENCY`,
`BROWSER_TASK_TIMEOUT_SECONDS`, `BROWSER_ACTION_TIMEOUT_MS`, `BROWSER_MAX_ACTIONS`,
`BROWSER_ALLOWED_DOMAINS` / `BROWSER_DENIED_DOMAINS` (plus the organization policy's
`browser_allowed_domains` / `browser_denied_domains`), `BROWSER_ALLOW_DOWNLOADS`,
`BROWSER_EXECUTABLE_PATH`, `RETENTION_BROWSER_ARTIFACTS_DAYS`.

| Environment | How to run |
|---|---|
| local | `make install-browser` (Playwright + Chromium; on Linux also `sudo .venv/bin/python -m playwright install-deps chromium`), then `make browser-worker` |
| Docker Compose | `docker compose --profile browser up -d` (image `backend/deploy/docker/Dockerfile.browser`, based on `mcr.microsoft.com/playwright/python:v1.56.0-noble`) |
| Kubernetes | `browser-worker-deployment.yaml`: own image, own Deployment, strict egress NetworkPolicy, optional dedicated node pool and GKE Sandbox |

**Chromium sandbox.** The executor launches Chromium with its own sandbox unless
`--no-sandbox` / `BROWSER_NO_SANDBOX=1` is given. That sandbox needs user-namespace system
calls that the default container seccomp profiles (Docker, containerd `RuntimeDefault`) block
for non-root containers, so the provided Compose service and Kubernetes Deployment set
`BROWSER_NO_SANDBOX=1` and rely on the container boundary: non-root uid, no capabilities,
read-only root filesystem, `no-new-privileges`, no cloud identity, egress limited to public
addresses, and — recommended in production — gVisor. Where you control the node, you can
instead apply Playwright's published seccomp profile to the container and drop
`BROWSER_NO_SANDBOX` to get both layers.

The Playwright Python package version must match the browsers in the image
(`PLAYWRIGHT_VERSION` build argument, default `1.56.0`).
