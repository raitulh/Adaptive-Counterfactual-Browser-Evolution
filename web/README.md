# AgentOS — web app

The AgentOS product frontend: a Next.js App Router application that turns the AgentOS API
(`../backend`, FastAPI) into a command center for autonomous agents — goal → plan → validate →
approve → execute → verify → recover → complete → learn — plus the public marketing site.

The backend is authoritative for everything: identity, permissions, plans, approvals, execution
state and verification. This app renders backend state, submits user intent, and never
re-implements business logic or invents API behaviour.

| Area | Technology |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack, React 19, `output: "standalone"`) |
| Language | TypeScript (strict), Zod v4 |
| Styling | Tailwind CSS 4 (CSS-first tokens in `src/app/globals.css`), Radix primitives (`radix-ui`), cmdk, vaul, sonner |
| Server state | TanStack Query 5 (+ TanStack Virtual for long lists) |
| Client state | Zustand — UI preferences only (sidebar, developer mode, palette) |
| Forms | React Hook Form + Zod, backend 422s mapped onto fields |
| API client | `openapi-typescript` types + `openapi-fetch`, generated from the backend OpenAPI document |
| Realtime | Fetch-based Server-Sent Events with short-lived stream tokens, `Last-Event-ID` resume and REST backfill |
| Motion / 3D | Motion (`motion/react`), React Three Fiber + Drei (marketing and hero only, lazy, with 2D fallback) |
| Tests | Vitest + Testing Library (unit/component), Playwright (end to end against the real API) |

## Quick start

Requirements: Node.js ≥ 20.9 and a running AgentOS API.

```bash
cp .env.example .env.local   # defaults target an API on http://localhost:8000
npm ci
npm run dev                  # http://localhost:3000
```

No Google credentials or model API key? Run the **simulated backend** — the real API, worker,
permission engine, approvals, verification and SSE, with a scripted model and an in-process
Google Workspace (Calendar, Gmail, Contacts, Drive, OAuth consent page):

```bash
cd ../backend && python scripts/simulated_backend.py --port 8000
```

Try goals such as *"Schedule a 30 minute meeting with Rahim tomorrow afternoon"* (plan → two
approvals → verified completion), *"…with Zoe…"* (asks you for her address), *"flaky calendar
check"* (retries, fails, resume), *"draft an email to Sara"*, *"what's unread in my inbox"*,
*"remember that I prefer morning meetings"*.

## How the app talks to the backend

```
browser ──same origin──▶ Next.js  /api/v1/*  ──stream──▶  AGENTOS_API_ORIGIN/api/v1/*
         (cookies are first-party)   (route handler: transport only)
```

* **One origin.** `NEXT_PUBLIC_API_URL=/api/v1` (default) sends every call to
  `src/app/api/v1/[...path]/route.ts`, which streams requests and responses (uploads, SSE) to
  `AGENTOS_API_ORIGIN`, read at request time — one build runs in every environment. The
  HttpOnly refresh cookie and the CSRF cookie are first-party, `SameSite=Strict` holds, and no
  CORS is involved. Deployments that must call the API cross-origin can set
  `NEXT_PUBLIC_API_URL` to an absolute URL (the API then needs `CORS_ORIGINS` and cookie
  settings for that site).
* **Typed contract.** `npm run api:generate` reads `../backend/docs/openapi.json` (or
  `OPENAPI_SOURCE`, a file path or URL) and writes `src/lib/api/generated/`. Unknown routes,
  parameters, bodies and enum values are type errors. `npm run api:check` fails when the
  generated client is stale (CI and the Docker build run it). In development the app also
  compares its contract fingerprint with the live API and shows a banner on drift.
* **Errors.** Every failure becomes an `AgentOSApiError` (`src/lib/api/errors.ts`) with a
  user-safe message, kind, request id, validation issues mapped to form fields, `Retry-After`
  for rate limits and `missing_permissions` for 403s. Raw backend bodies are never rendered.
* **Auth.** The access token lives in memory only. The refresh token is an HttpOnly cookie
  (`/api/v1/auth` path); refresh sends the double-submit CSRF header, is single-flight within a
  tab and serialized across tabs (Web Locks + BroadcastChannel, because refresh tokens rotate
  and reuse revokes the session). A 401 triggers one refresh and one retry — never a loop.
  Registration returns tokens in the body once; the app immediately exchanges that refresh
  token for the cookie form and drops it. Google sign-in and Workspace connection use the
  backend-generated authorization URLs (state + PKCE on the server).
* **Realtime.** Task pages open `GET /tasks/{id}/events/stream` with a single-use stream token
  from `POST /auth/stream-token` (never the access token in a URL), resume with
  `Last-Event-ID`, back off on failure, and reconcile with `GET /tasks/{id}/events` (dedupe by
  sequence, gap repair). The shell keeps one user stream for notifications and list freshness.
* **Idempotency.** Task creation, approvals and other retry-prone writes send an
  `Idempotency-Key` created once per logical submission and reused on retries.
* **Permissions.** The UI hides or disables what the current role cannot do
  (`usePermissions`), but every screen still handles `403` — the backend decides.

Rules for contributors are in [`docs/frontend-conventions.md`](docs/frontend-conventions.md).

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server (Turbopack) |
| `npm run build` / `npm start` | Production build / server (`.next/standalone` for containers) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (Next.js, React Hooks, TypeScript rules) |
| `npm run format` / `format:check` | Prettier (+ Tailwind class sorting) |
| `npm run api:generate` / `api:check` | Regenerate / verify the typed API client from the backend OpenAPI document |
| `npm test` | Unit and component tests (Vitest, jsdom) |
| `npm run test:e2e` | Playwright end-to-end suite (see below) |
| `npm run check` | `api:check` + typecheck + lint + unit tests |

After changing the backend API: `cd ../backend && make openapi`, then `npm run api:generate`,
then fix the type errors that point at every affected call site.

## Configuration

| Variable | Scope | Default | Meaning |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | build | `/api/v1` | API base the browser calls. Must end in `/api/v1`. |
| `AGENTOS_API_ORIGIN` | runtime (server) | `http://localhost:8000` | Where the same-origin pass-through sends API calls. |
| `NEXT_PUBLIC_SITE_URL` | build | `http://localhost:3000` | Canonical URL for metadata, sitemap and Open Graph. |
| `NEXT_PUBLIC_DEMO_MODE` | build | `false` | In-browser simulated backend for demos (see below). Never enable for a real deployment. |
| `NEXT_PUBLIC_ANALYTICS_PROVIDER` | build | `none` | Product analytics sink (`none`, `console`). Events never carry goals, prompts, e-mail content, tokens or ids of user data. |

`NEXT_PUBLIC_*` values are compiled into the client bundle; nothing secret belongs in them.
The web tier holds no secrets at all.

## Demo mode

`NEXT_PUBLIC_DEMO_MODE=true` swaps the network transport for an in-browser simulation of the
AgentOS API (same routes and payload shapes, generated from the same OpenAPI types) so the product
can be explored without a backend. The app shows a persistent *Demo mode* banner, and nothing
leaves the browser. It exists for design reviews and offline demos; a production deployment must
build with it off (the default), and the simulated backend above is the right tool for realistic
local work.

## Tests

```bash
npm test                       # unit + component (API client, auth refresh, SSE parser, event merging, …)

npm run build                  # the e2e suite runs the production build
npm run test:e2e               # starts backend/scripts/e2e_backend.py (port 8100) and next start (port 3100)
E2E_BASE_URL=https://staging.example.com npm run test:e2e   # against an existing deployment
```

`backend/scripts/e2e_backend.py` runs the real API and worker against PostgreSQL and Redis from
`backend/.env`, but in an isolated database (`agentos_e2e`, recreated on every start) and Redis
database 15, with the scripted model and simulated Google Workspace. Each test registers its own
user and organization, so tests run in parallel without sharing data.

## Deployment

The image is built from the repository root so the build can verify the API client against the
backend contract:

```bash
docker build -f web/Dockerfile -t agentos-web \
  --build-arg NEXT_PUBLIC_SITE_URL=https://app.example.com .
docker run -p 3000:3000 -e AGENTOS_API_ORIGIN=http://api:8000 agentos-web
```

* **Compose:** `backend/docker-compose.yml` includes a `web` service on `127.0.0.1:3000`.
* **Kubernetes:** `backend/deploy/k8s/web-deployment.yaml` (Deployment, Service, HPA, PDB);
  the ingress routes `app.<domain>` to the web app, and network policies allow only
  ingress → web → API.
* **Health:** `GET /healthz` (process liveness; it does not call the API).

Operational requirements:

1. **Proxy buffering off for event streams.** Anything between the browser and the web app
   (ingress, CDN) must not buffer or compress `text/event-stream` responses and must allow
   long-lived requests (≥ 1 hour read timeout). The app already sends
   `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no`.
2. **Client IPs for rate limiting.** The web app forwards `X-Forwarded-For`; configure the API
   to trust the web tier and your ingress (`FORWARDED_ALLOW_IPS`), and make sure the edge
   proxy sets `X-Forwarded-For` itself (clients must not reach the web app directly with a
   forged header).
3. **Backend URLs.** Point the backend at the web origin: `GOOGLE_LOGIN_REDIRECT_URI=
   https://app.example.com/callback/google`, `GOOGLE_REDIRECT_URI=https://app.example.com/api/v1/integrations/google/callback`,
   `FRONTEND_OAUTH_SUCCESS_URL=https://app.example.com/app/integrations?status=connected`,
   `FRONTEND_OAUTH_ERROR_URL=…?status=error`, `PUBLIC_BASE_URL=https://app.example.com`,
   `COOKIE_SECURE=true`.
4. **HTTPS only** in production (secure cookies, HSTS is sent by the app).

## Security model (frontend)

* No tokens in `localStorage`/`sessionStorage`, URLs, logs or analytics. The e2e suite asserts
  this after sign-in.
* Refresh token only as an HttpOnly, `SameSite=Strict` cookie; CSRF double-submit on refresh.
* Logout clears the in-memory session, the query cache and the CSRF cookie in every tab.
* Organization switching clears all cached tenant data.
* Security headers (`next.config.ts`): baseline CSP (`frame-ancestors 'none'`,
  `object-src 'none'`, `base-uri`/`form-action 'self'`), `X-Frame-Options: DENY`, `nosniff`,
  strict referrer policy, restrictive `Permissions-Policy`, COOP, HSTS in production; the app
  and callback pages are `noindex`.
* Frontend permission checks are cosmetic; the backend enforces RBAC and tenant isolation.
