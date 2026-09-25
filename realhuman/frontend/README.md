# RealHuman — web

Marketing site, interactive verification demo, documentation preview, login and
developer dashboard shell for **RealHuman**, human verification infrastructure
for the AI era.

Everything runs without a backend: a deterministic **mock adapter** serves the
demo and dashboard. Switch one environment variable to use the real FastAPI
verification service in [`../backend`](../backend) instead (**live mode**).

> Mock mode is for UI development and demos only. It provides no protection.

---

## Quick start

```bash
cd realhuman/frontend
npm ci
cp .env.example .env.local   # optional — defaults work out of the box
npm run dev                   # http://localhost:3000
```

Requires Node.js 20.9 or newer.

### Live mode (real backend)

Start the API first (see [`../backend/README.md`](../backend/README.md) or run
`docker compose up` from `realhuman/`), then:

```bash
# .env.local
NEXT_PUBLIC_VERIFICATION_MODE=live
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
NEXT_PUBLIC_SITE_KEY=pk_test_demo_5f2c81a9e04b   # demo project seeded by the API
```

`NEXT_PUBLIC_*` values are inlined at build time: restart `npm run dev` (or
rebuild) after changing them. Open the site as `http://localhost:3000` — the
API's default CORS origin — not `127.0.0.1`.

| Route          | What it is                                                                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`            | Landing page: hero with WebGL verification network, live demo, problem, how it works, signal engine, developer API, use cases, security, dashboard preview, pricing, FAQ |
| `/docs`        | Documentation preview: quickstart, flow, API reference, signals, policies, webhooks, errors, mock mode, privacy                                                          |
| `/login`       | Log in (`?mode=signup` to create an account)                                                                                                                             |
| `/dashboard/*` | Developer dashboard shell: overview, sessions, signals, API keys, webhooks, logs, settings                                                                               |

## Scripts

| Command             | Purpose                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Development server (Turbopack)                                        |
| `npm run build`     | Production build (includes TypeScript checking)                       |
| `npm start`         | Serve the production build                                            |
| `npm run lint`      | ESLint (Next.js core-web-vitals + TypeScript + React Compiler rules)  |
| `npm run typecheck` | `tsc --noEmit`                                                        |
| `npm run format`    | Prettier (with Tailwind class sorting)                                |
| `npm test`          | Vitest unit and component tests                                       |
| `npm run test:e2e`  | Playwright end-to-end tests (builds and starts the app automatically) |
| `npm run check`     | typecheck + lint + unit tests + build                                 |

First-time Playwright setup: `npx playwright install chromium`.

## Environment variables

All variables are public (`NEXT_PUBLIC_*`) and inlined at build time. **Never put
secrets here.** Invalid values fall back to safe defaults.

| Variable                        | Default                 | Purpose                                                             |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `NEXT_PUBLIC_PRODUCT_NAME`      | `RealHuman`             | Product name used across UI and metadata                            |
| `NEXT_PUBLIC_SITE_URL`          | —                       | Canonical URL; enables canonical links, sitemap and JSON-LD         |
| `NEXT_PUBLIC_VERIFICATION_MODE` | `mock`                  | `mock` (in-browser adapter) or `live` (HTTP adapter)                |
| `NEXT_PUBLIC_API_BASE_URL`      | `http://localhost:8000` | Backend origin for `live` mode; also added to the CSP `connect-src` |
| `NEXT_PUBLIC_SITE_KEY`          | —                       | Public site key the demo sends when creating sessions (`live` mode) |
| `NEXT_PUBLIC_ENABLE_DEMO`       | `true`                  | Show the interactive demo on the landing page                       |
| `NEXT_PUBLIC_ENABLE_3D`         | `true`                  | Enable the WebGL hero; `false` always uses the static SVG visual    |
| `NEXT_PUBLIC_GITHUB_URL`        | —                       | Footer GitHub link, shown only when set to a valid `https://` URL   |

## Architecture

```
src/
  app/                    Routes (App Router). Server components by default.
    (marketing)/          Landing page and /docs, sharing navbar + footer
    dashboard/            Dashboard shell and pages
    login/                Auth screen
  components/
    marketing/            Landing-page sections
    demo/                 Interactive verification demo (widget, console, hold challenge)
    dashboard/            Dashboard shell, tables, dialogs, page views
    docs/                 Documentation building blocks
    visuals/              WebGL orb, SVG fallback, chart, rings
    ui/                   Design-system primitives (Radix-based)
  hooks/                  Client hooks (media queries, demo orchestration, data)
  lib/
    api/                  Adapter contract, mock adapter, HTTP adapter, errors
    schemas/              Zod contracts (verification, dashboard, forms, errors)
    verification/         Signal catalog and scoring/policy logic
    demo/                 Pure demo state machine
    constants/            Copy, navigation, code samples, motion tokens
    state/                Zustand store (dashboard UI only)
    utils/                Formatting, URL safety, highlighter, PRNG
tests/
  unit/                   Vitest
  e2e/                    Playwright
```

**Data flow.** Components never call `fetch`. They use the `RealHumanApi`
contract (`src/lib/api/types.ts`), implemented twice:

- `mock/mock-api.ts` — deterministic, in-memory, simulated latency, scenario
  support (`success`, `step_up`, `timeout`, `network_error`).
- `http/http-api.ts` — `fetch` with timeouts, cancellation, `credentials: "include"`,
  error normalization and **Zod validation of every response** before it
  reaches the UI.

`getApi()` picks the adapter from `NEXT_PUBLIC_VERIFICATION_MODE`; the unused
adapter is removed at build time. The landing page loads the adapter lazily
(`loadApi()`) on first interaction, so validation code stays off the critical
path.

**State.** Server data goes through TanStack Query (`src/hooks/use-dashboard-data.ts`,
central `query-keys.ts`). The demo is a pure reducer (`src/lib/demo/machine.ts`)
driven by `useVerificationDemo`, which handles cancellation, stale-result
protection and the session countdown. Zustand holds one piece of cross-component
UI state: the persisted sidebar collapse (rehydrated after mount to avoid
hydration mismatches).

**Scoring.** `src/lib/verification/scoring.ts` is the single source of truth for
signal classification, weighted aggregation and policy decisions. No single
signal can deny a session: a failing signal can only lower an allow to a step-up.

**Design system.** Tokens live in `src/app/globals.css` (Tailwind v4 `@theme`):
semantic colors (`background`, `surface*`, `border*`, `foreground`, `muted`,
`subtle`, `success`, `accent`, `warning`, `danger`), fluid type scale
(`text-display` … `text-code`), radii, shadows, easing, container widths,
section spacing, z-index layers and motion durations (mirrored for Framer Motion
in `src/lib/constants/motion.ts`). Green is reserved for verified states, amber for
caution and recoverable errors, red only for negative risk outcomes.

**Hero visual (progressive enhancement).**

1. Server-rendered SVG network is always painted first (works without JS/WebGL).
2. On capable devices (hardware WebGL, checked with `failIfMajorPerformanceCaveat`),
   the React Three Fiber scene loads on idle and cross-fades in.
3. Reduced motion → final state rendered on demand, no pointer follow. Off-screen
   or hidden → the render loop pauses. WebGL context loss → back to SVG.
   A drei `PerformanceMonitor` lowers pixel ratio when frame rate drops.

## Backend contract

Implemented by the FastAPI service in [`../backend`](../backend). JSON over HTTPS, camelCase fields (with Pydantic, use
`ConfigDict(alias_generator=to_camel, populate_by_name=True)`). Errors use
`{ "error": { "code", "message", "requestId" } }`; FastAPI's default
`{ "detail": … }` is also handled via the status code.

| Method          | Path                                | Used by          | Response schema                       |
| --------------- | ----------------------------------- | ---------------- | ------------------------------------- |
| POST            | `/v1/sessions`                      | widget / demo    | `verificationSessionSchema`           |
| POST            | `/v1/sessions/{id}/challenge`       | widget / demo    | `verificationResultSchema`            |
| POST            | `/v1/verify`                        | customer servers | (documented in `/docs`)               |
| GET             | `/v1/dashboard/overview`            | dashboard        | `overviewSchema`                      |
| GET             | `/v1/events?limit=`                 | dashboard        | `verificationEventSchema[]`           |
| GET             | `/v1/sessions?outcome=`             | dashboard        | `sessionRecordSchema[]`               |
| GET             | `/v1/logs?limit=`                   | dashboard        | `requestLogSchema[]`                  |
| GET/POST/DELETE | `/v1/api-keys[/{id}]`               | dashboard        | `apiKeySchema`, `createdApiKeySchema` |
| GET/POST/DELETE | `/v1/webhooks[/{id}]`               | dashboard        | `webhookEndpointSchema`               |
| GET/PUT         | `/v1/project/settings`              | dashboard        | `projectSettingsRecordSchema`         |
| POST            | `/v1/auth/login`, `/v1/auth/signup` | login            | `{ email, workspace }`                |
| GET             | `/v1/auth/me`                       | dashboard topbar | `{ email, workspace }`                |
| POST            | `/v1/auth/logout`                   | dashboard topbar | `204`                                 |
| POST            | `/v1/contact`                       | pricing dialog   | `{ received: true }`                  |

The backend allows the site origin via CORS with credentials and sets the login
cookie as `HttpOnly; SameSite=Lax` (plus `Secure` in production). REST returns
all signals at once; the adapter replays them through `onSignal`, so a future
WebSocket transport can stream them without UI changes.

**Live-mode behavior.**

- The challenge body carries optional `telemetry` — aggregate interaction
  features computed in the browser by `src/lib/verification/telemetry.ts`
  (reaction time, pointer approach straightness and speed variance, hold jitter,
  key auto-repeat, synthetic-event count, `navigator.webdriver`). Counts and
  ratios only; no coordinates, keystrokes or identifiers leave the page. The
  mock adapter ignores it.
- Any dashboard request answered with `UNAUTHORIZED` redirects to
  `/login?next=…`; after login the user returns to that dashboard page. The
  topbar shows the signed-in workspace and logs out through the API.
- Creating a webhook endpoint reveals its signing secret once (the API returns
  `signingSecret`; it never enters the query cache).

## Mock mode details

- Demo scenarios are selectable in the demo UI. Each failure is shown once; the
  recovery path (retry / continue / start over) then succeeds.
- Sessions expire after 30 seconds (the countdown is visible in the widget).
- Mock login accepts any valid email/password except `incorrect-password`, which
  returns an invalid-credentials error for testing.
- Mock API keys look real but are random strings valid against nothing. The
  secret is shown once and never cached; lists only hold masked values.

## Quality checks (as run for this commit)

- `npm run typecheck`, `npm run lint`, `npm run format:check` — clean.
- `npm test` — 83 unit/component tests (including telemetry features and the
  live-mode auth / webhook-secret adapter calls).
- `npm run test:e2e` — 28 Playwright tests: demo success / step-up / timeout /
  network error / early release / single-step, navigation and links, skip link,
  FAQ keyboard, code copy, contact form, 404, reduced motion, mobile drawer focus
  trap and scroll lock, no-WebGL fallback, login errors, API key reveal-once,
  webhook validation, persisted sidebar, clean console (no hydration warnings).
- Live mode, driven in Chromium against the FastAPI backend and PostgreSQL:
  demo verification → token → `/v1/verify` (single use), signup, API key,
  webhook signing secret, logout, `/dashboard` auth redirect.

Measured for the original frontend release (not re-measured after the backend
integration):

- axe-core (WCAG 2.2 AA + best practices) on every route at 1440px and 390px — no violations.
- No horizontal overflow at 320, 375, 430, 768, 1024, 1280 and 1920px.
- Landing page, production build, measured locally in headless Chromium: LCP ≈ 0.55s
  (≈ 1.3s with 4× CPU throttling and a ~1.6 Mbps / 150 ms network), CLS 0 unthrottled
  (≈ 0.045 on the throttled network, from the web-font swap), ~288 KB of compressed JS
  before interaction; three.js (~234 KB) loads only after idle on WebGL-capable devices.

## Security notes

- No secrets in client code; every environment value is public by design.
- Security headers (`next.config.ts`): CSP, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS.
- Tokens, secrets and identifiers are masked in the UI (`maskSecret`, `maskId`).
- Request/response payloads are never logged; errors expose only safe messages.
- External URLs from configuration pass `toSafeExternalUrl` (https only, no credentials).

## Dependency decisions

- **Framer Motion** (with `LazyMotion`) for reveals and micro-interactions. GSAP was
  not added: no sequence here needs a timeline engine.
- **next-themes** was not added: the product is dark-only by design.
- **Zustand** is limited to one persisted UI flag; everything else is local state,
  a reducer, or TanStack Query.
- **three.js** is pinned to `~0.182` because newer releases deprecate `THREE.Clock`,
  which React Three Fiber 9 still uses (it logs a console warning).
- Syntax highlighting is a ~150-line tokenizer instead of an editor bundle.

## Known limitations and next steps

- In live mode the dashboard is protected client-side (401 → login). A server-side
  check (a `proxy.ts` reading the session cookie) needs the cookie on the site's
  own domain — set `COOKIE_DOMAIN` on the API when app and API share a parent domain.
- The CSP allows `'unsafe-inline'` scripts because static pages cannot carry a
  per-request nonce; move to a nonce-based CSP if pages become dynamic.
- Code samples document the beta API contract; SDK package names are illustrative.
- Pricing, compliance and customer claims are intentionally absent until they are real.
