# RealHuman

Human verification infrastructure for the AI era — a Next.js web app (marketing
site, interactive demo, docs, developer dashboard) and the FastAPI + PostgreSQL
verification service behind it.

```
RealHuman web (Next.js)          frontend/
        │  HTTPS / JSON, camelCase, HttpOnly session cookie
        ▼
RealHuman API (FastAPI)          backend/
        ├── Auth (accounts, cookie sessions)
        ├── Verification engine ── signal engine ── risk engine
        ├── Sessions, tokens, /v1/verify
        ├── API keys, webhooks (signed, retried), project settings
        ├── Dashboard read models, request logs
        └── Background worker (webhooks, expiry, retention)
        ▼
PostgreSQL
```

The web app talks to the API only through its `RealHumanApi` contract. The
in-browser **mock** adapter stays available for UI work and demos; **live** mode
uses this API.

## Quick start — everything with Docker

```bash
cd realhuman
docker compose up --build
```

| URL                        | What                                                   |
| -------------------------- | ------------------------------------------------------ |
| http://localhost:3000      | Web app in live mode                                   |
| http://localhost:8000/docs | API reference (OpenAPI)                                |
| Demo login                 | `demo@realhuman.dev` / `realhuman-demo-password`       |

The landing-page demo creates real sessions in the demo project; log in as the
demo account to see them on the dashboard, create an API key and redeem tokens
with `POST /v1/verify`. Sign up to get your own project and site key.

## Quick start — without Docker

1. PostgreSQL 14+ with a `realhuman` database (user/password `realhuman`).
2. API:
   ```bash
   cd realhuman/backend
   python -m venv .venv && source .venv/bin/activate
   pip install -r requirements-dev.txt
   cp .env.example .env
   alembic upgrade head
   uvicorn app.main:app --reload            # :8000
   ```
3. Web app:
   ```bash
   cd realhuman/frontend
   npm ci
   cp .env.example .env.local
   # in .env.local: NEXT_PUBLIC_VERIFICATION_MODE=live
   npm run dev                              # :3000 — open http://localhost:3000
   ```

With `NEXT_PUBLIC_VERIFICATION_MODE=mock` (the default) the web app needs no
backend at all.

## Integrating a customer site

1. Sign up, copy the **site key** from Settings and create a **secret key**
   under API keys.
2. Browser: create a session with the site key and complete the challenge
   (`POST /v1/sessions`, `POST /v1/sessions/{id}/challenge`). On `allow` the
   response carries a single-use token.
3. Server: redeem the token once.

```bash
curl -X POST http://localhost:8000/v1/verify \
  -H "Authorization: Bearer $REALHUMAN_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "token": "rh_vt_…" }'
```

```json
{
  "session": "sess_7f3a9c2e41d8a0b1",
  "verified": true,
  "decision": "allow",
  "risk": "low",
  "score": 0.93,
  "action": "signup",
  "origin": "app.example.com",
  "signals": [{ "id": "interaction_pattern", "status": "pass", "score": 0.95, "…": "…" }],
  "decidedAt": "2026-09-25T12:04:30.512Z",
  "redeemedAt": "2026-09-25T12:04:31.020Z"
}
```

A second redemption returns `410`. Webhooks (`verification.completed`,
`verification.step_up`, `verification.blocked`, `session.expired`) are signed
with `RealHuman-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<body>")>`.

## API

| Method          | Path                                              | Auth                 |
| --------------- | ------------------------------------------------- | -------------------- |
| POST            | `/v1/sessions`                                    | public site key      |
| POST            | `/v1/sessions/{id}/challenge`                     | session id           |
| POST            | `/v1/verify`                                      | secret API key       |
| GET             | `/v1/dashboard/overview`, `/v1/events`, `/v1/logs` | dashboard cookie     |
| GET             | `/v1/sessions?outcome=`                           | dashboard cookie     |
| GET/POST/DELETE | `/v1/api-keys[/{id}]`, `/v1/webhooks[/{id}]`      | dashboard cookie     |
| GET/PUT         | `/v1/project/settings`                            | dashboard cookie     |
| POST / GET      | `/v1/auth/signup`, `/login`, `/logout`, `/me`     | —                    |
| POST            | `/v1/contact`                                     | —                    |
| GET             | `/healthz`, `/readyz`                             | —                    |

Details: [backend/README.md](backend/README.md) (engine, security model,
configuration, production checklist) and [frontend/README.md](frontend/README.md)
(web app architecture, mock mode, design system).

## Checks

| Where       | Command                                              | Result for this commit |
| ----------- | ---------------------------------------------------- | ---------------------- |
| `backend/`  | `pytest` (SQLite) and with `TEST_DATABASE_URL` (PostgreSQL 16) | 88 passed each |
| `backend/`  | `ruff check . && ruff format --check . && alembic check` | clean              |
| `frontend/` | `npm run typecheck && npm run lint && npm run format:check` | clean           |
| `frontend/` | `npm test`                                           | 83 passed              |
| `frontend/` | `npm run test:e2e` (mock mode, production build)     | 28 passed              |
| both        | Live run in Chromium against the API + PostgreSQL    | demo verify → token → `/v1/verify` once, signup, API key, webhook secret, logout, auth redirect |

The Docker images were written for this commit but not built here (no Docker
daemon was available).
