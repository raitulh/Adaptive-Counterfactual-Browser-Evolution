# RealHuman — API

FastAPI + PostgreSQL implementation of the `RealHumanApi` contract the web app
in [`../frontend`](../frontend) expects: verification sessions, the signal and
risk engines, single-use tokens, dashboard read models, API keys, webhooks,
project settings, accounts and the contact form.

## Run it

```bash
cd realhuman/backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env              # SEED_DEMO=true creates the demo account

# PostgreSQL (any 14+). With Docker:
docker run -d --name realhuman-db -p 5432:5432 \
  -e POSTGRES_USER=realhuman -e POSTGRES_PASSWORD=realhuman -e POSTGRES_DB=realhuman \
  postgres:16-alpine

alembic upgrade head
uvicorn app.main:app --reload     # http://localhost:8000, docs at /docs
```

Demo login (local only): `demo@realhuman.dev` / `realhuman-demo-password`,
project site key `pk_test_demo_5f2c81a9e04b`.

Management commands:

```bash
python -m app.cli seed                    # demo account + project
python -m app.cli create-user you@co.com  # account with its own project and site key
```

## Tests and checks

```bash
pytest                      # 88 tests, in-memory SQLite
TEST_DATABASE_URL=postgresql+psycopg://realhuman:realhuman@localhost:5432/realhuman_test pytest
ruff check . && ruff format --check .
alembic check               # models and migrations agree
```

## Layout

```
app/
  main.py                 App factory, middleware order, lifespan (seed + worker)
  config.py               Settings from environment variables
  errors.py               { "error": { code, message, requestId } } envelope
  middleware.py           Request IDs, request log, crash envelope, two-policy CORS
  api/                    Routers: auth, sessions, verify, dashboard, api_keys,
                          webhooks, settings, contact, health (+ deps.py)
  models/                 SQLAlchemy 2.0 models (users, projects, sessions, signals,
                          events, request logs, api keys, webhooks, deliveries…)
  schemas/                Pydantic models, camelCase on the wire
  services/
    signal_engine.py      Factors → the four public signals (pure functions)
    risk_engine.py        Weighted aggregate + policy (port of scoring.ts)
    verification_engine.py  Challenge evaluation, tokens, redemption
    session_service.py    Session lifecycle, outcome events, expiry
    webhook_service.py    Outbox, HMAC signing, retries, SSRF guard
    dashboard_service.py  Overview, events, sessions, logs
    retention.py          Per-project data retention
    worker.py             Background thread: webhooks, expiry, retention
  security/               Argon2id passwords, cookie sessions, API keys,
                          keyed hashing, secret encryption, rate limiter
  db/                     Engine/session factory, Alembic migrations
tests/                    pytest suite
```

## How a verification is decided

```
widget ── POST /v1/sessions {siteKey, action} ──► session (TTL 120 s), client fingerprint stored as keyed hashes
widget ── POST /v1/sessions/{id}/challenge {type, inputMethod, holdDurationMs, telemetry}
            │
            ├─ validity: exists, not expired (410), not decided, attempts left
            ├─ context:  request metadata, IP class/reputation, per-network rates (DB)
            ├─ signal engine ─ factor families ─► 4 public signals (score 0–1 + detail)
            ├─ risk engine   ─ weighted mean + project policy ─► allow / step_up / deny
            └─ persist signals (with factor breakdown), decision, event, webhook deliveries
               allow → single-use token rh_vt_… (5 min), stored as a hash
server ── POST /v1/verify {token} (Bearer rh_live_sk_…) ──► decision, once; replay → 410
```

Five factor families feed the four signals the web app's catalog defines, so the
public contract stays stable while detection evolves:

| Public signal (weight)      | Factor families      | Examples                                                                                           |
| --------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| `interaction_pattern` (0.3) | behavior, automation | reaction time, pointer approach straightness / speed variance, key auto-repeat, synthetic events   |
| `challenge_response` (0.3)  | challenge            | hold ≥ required, hold not longer than the session existed, time to react, retries                 |
| `session_consistency` (0.2) | session, automation  | same UA / IP / language / origin start→finish, `navigator.webdriver`, automation UAs, fetch metadata |
| `request_behavior` (0.2)    | rate, network        | sessions and challenges per network in 10 min, recent blocks, blocklisted / datacenter CIDRs      |

Policy (identical to `src/lib/verification/scoring.ts`): signals are `pass` ≥ 0.75,
`review` ≥ 0.5, else `fail`; aggregate ≥ allow threshold → `allow`, ≥ step-up
threshold → `step_up`, else `deny`; one failing signal can lower `allow` to
`step_up` but never denies alone. Thresholds come from the project settings. A
session that is still `step_up` on its last permitted attempt is blocked.

Every factor is stored with its impact and note in `signals.factors`, so each
decision is explainable after the fact.

## Security model

- **Accounts:** Argon2id hashes, constant-work login (dummy hash for unknown
  emails), per-IP and per-account login limits, 12–128 character passwords.
- **Sessions:** random 256-bit cookie token, only its SHA-256 stored;
  `HttpOnly`, `SameSite=Lax`, `Secure` in production; server-side revocation.
- **CSRF:** cookie-authenticated writes reject untrusted `Origin` headers, on top
  of `SameSite` and CORS preflights.
- **CORS:** dashboard origins get credentials; any origin may call only
  `POST /v1/sessions` and `POST /v1/sessions/{id}/challenge`, without credentials.
  `GET /v1/sessions` (dashboard data) is never readable cross-origin.
- **API keys / tokens:** high-entropy secrets stored as SHA-256; shown once.
- **Privacy:** IP, user agent and language are stored only as HMAC hashes keyed
  by `SECRET_KEY`. Telemetry is aggregate. No request payloads are logged.
- **Webhooks:** https only, no credentials in URLs, private/loopback targets
  refused at creation and every resolved address re-checked at delivery; signing
  secrets encrypted at rest (Fernet, key derived from `SECRET_KEY`).
- **Errors:** uniform envelope with a request ID; validation errors list field
  paths without echoing input; 500s never expose internals.

## Production checklist

- `ENVIRONMENT=production`, a random `SECRET_KEY` (32+ chars, keep it stable —
  rotating it invalidates pseudonymized hashes and webhook secrets),
  `SEED_DEMO=false`, `DOCS_ENABLED` as you prefer.
- `CORS_ORIGINS` = your dashboard origin(s). Serve API and app on the same
  parent domain (e.g. `app.` / `api.`) so `SameSite=Lax` cookies work, or use
  `COOKIE_SAMESITE=none` (requires HTTPS).
- `TRUSTED_PROXY_COUNT` = number of proxies in front of the API, so client IPs
  come from the right `X-Forwarded-For` hop.
- The rate limiter is in-process: with several API instances, move it to a
  shared store (Redis). Run the background worker on one instance, or rely on
  `SKIP LOCKED` claiming when running it on several.
- Feed `BLOCKLIST_CIDRS` / `DATACENTER_CIDRS` from an IP-intelligence source, or
  replace `NetworkClassifier` with a provider client.

## Known limitations

- Client-side signals can be forged by a determined attacker who reproduces a
  real browser perfectly; the engine raises the cost (timing checks, cross-request
  consistency, rate history) but is not a guarantee. Next steps: proof-of-work
  for high-volume abuse, device attestation (Private Access Tokens / Play
  Integrity), an ASN / proxy / Tor feed, and learned weights from labeled traffic.
- One project per account; teams and multiple projects need a membership model.
- Test and live API keys are both accepted for the project's tokens.
