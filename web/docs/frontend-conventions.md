# AgentOS web — engineering conventions

Read this before adding a feature. The foundation (API layer, auth, realtime, status mapping,
design system, app shell) is shared by every surface; features build on it, they do not
re-implement it.

> This project uses **Next.js 16** (App Router, Turbopack, React 19). APIs differ from older
> versions: read `node_modules/next/dist/docs/` before using a Next.js API you are unsure about.
> In particular: `params`/`searchParams` are **Promises** (`await props.params` in server
> components, `use(props.params)` in client components); middleware is `src/proxy.ts`.

## 1. Layout

```
src/
  app/
    (marketing)/          public, indexable pages (/, /product, /security, /pricing, /docs)
    (auth)/               /login, /signup, /callback/google (noindex)
    (app)/app/            the authenticated product (/app/...), noindex, wrapped in AuthGate + AppShell
    api/v1/[...path]/     same-origin pass-through to the backend (transport only)
  components/
    ui/                   design-system primitives (import from "@/components/ui")
    layout/               app shell: sidebar, topbar, command palette, notifications
    brand/                logo/wordmark
    <feature>/            feature components (tasks, agents, approvals, memory, …)
    three/                React Three Fiber scenes (marketing, command center) — no API logic inside
  lib/
    api/                  THE ONLY way to talk to the backend (typed client + domain modules)
    auth/                 AuthProvider, useAuth, useCurrentUser, useOrganization, usePermissions
    realtime/             SSE client, useTaskStream, useUserStream
    query/                QueryClient defaults, query keys (qk), useCursorQuery
    status/               presentation for backend enums (labels, tones, allowed task controls)
    format/               dates, durations, bytes, numbers, tool names
    motion.ts             motion presets
    analytics/            privacy-safe product analytics
  stores/ui.ts            Zustand: UI preferences only (sidebar, developer mode, palette state)
  config/navigation.ts    sidebar/palette navigation with permissions
```

## 2. Backend integration — hard rules

1. **All backend calls go through `@/lib/api`** (`tasksApi`, `approvalsApi`, …). Never call `fetch`
   in components. The client is generated from the backend OpenAPI document
   (`npm run api:generate`); TypeScript rejects unknown paths, params and bodies.
2. **Never invent routes, fields or status values.** If the product needs something the backend
   does not provide, do not fake it — surface it as a limitation (and tell the integrator).
3. **Types come from `@/lib/api`** (e.g. `TaskOut`, `StepOut`, `ApprovalOut`, `TaskStatus`). No
   hand-written copies of backend models.
4. **Server state = TanStack Query**, keys from `qk` (`@/lib/query/keys`). Every resource has a
   query hook, loading/error/empty states, and precise invalidation after mutations. Use
   `useCursorQuery` for keyset-paginated lists (`next_cursor`/`has_more`) — never page numbers.
5. **Idempotency**: for writes that accept `Idempotency-Key` (task creation, approvals, memory,
   automations, MCP, evaluations, experiments, files), create the key once per *logical*
   submission (`newIdempotencyKey()`, keep it in a ref/state) and reuse it on retries of the same
   submission; make a new one only for a new submission.
6. **Backend state drives the UI.** Never show "completed", "approved" or "verified" because an
   animation ended or a mutation resolved optimistically. Execution and verification are
   visually distinct. Optimistic updates only where harmless (e.g. marking a notification read).
7. **Auth**: access tokens live in memory (`sessionStore`), refresh is an HttpOnly cookie handled
   by `@/lib/api/session`. Never store tokens or user data in `localStorage`. Never put tokens in
   URLs (SSE uses short-lived stream tokens — `@/lib/realtime` does this for you).
8. **Permissions** (`usePermissions().can("agents:manage")`) only shape the UI. The backend is
   authoritative; every screen must handle 403 (`ErrorState` renders `PermissionDenied`).
9. **Organization switching clears the whole query cache** (handled by AuthProvider). Never keep
   tenant data in module-level variables.
10. **Dangerous actions** (delete, disconnect, revoke, disable, reject high-risk approvals, promote,
    rollback) use `ConfirmDialog`; irreversible deletes use `confirmText` (type-to-confirm).

## 3. Realtime

- `useTaskStream(taskId)` gives the ordered, de-duplicated event list for a task (REST backfill +
  SSE + gap repair + reconnect) and invalidates task detail/summary on every event.
- The user-wide stream is mounted once by the shell. Subscribe to raw messages with
  `onUserStreamMessage` if you need toasts; list queries are already invalidated.
- Do not poll when a stream covers the data. Slow background refetch is fine as a safety net.

## 4. Errors, empty and loading states

- Query errors → `<ErrorState error={query.error} onRetry={query.refetch} />`.
- Form/mutation errors → `<InlineError error={...} />` or `toastError(err)`; map
  `err.fieldErrors` onto form fields (react-hook-form `setError`).
- Show the request id (`RequestId`) when present; never raw JSON, stack traces or backend bodies.
- Empty states are meaningful and actionable (`EmptyState` with a real next step). Never
  "No data found".
- Loading states are contextual skeletons shaped like the content (`Skeleton`), not page spinners.

## 5. Design system

- Tokens live in `src/app/globals.css` (`@theme`). Use the token classes (`bg-surface-1`,
  `text-fg-muted`, `border-line`, `text-accent`, …). Do not add new colors.
- Tone meanings are fixed: **accent** = active execution / primary action, **verify** (violet) =
  verification, **warning** (amber) = waiting for a human, **recover** (orange) = recovery /
  reconciliation, **success** = verified completion, **danger** = failure/destructive,
  **info** = neutral information. Use `StatusBadge`, `RiskBadge`, `PermissionBadge`,
  `toneClasses` — never ad-hoc status colors.
- Typography: `font-sans` (Inter Tight) for UI, `font-mono` (JetBrains Mono) for ids, tool names,
  checksums, event types, sequences, JSON. Page titles via `PageHeader`; content width via
  `PageContainer`.
- Glass/blur and glows sparingly. Borders are thin (`border-line`), shadows minimal.
- Motion (`@/lib/motion`): micro 100–250 ms, panels 200–350 ms, cinematic 500–1200 ms; animate to
  communicate state/progress/cause — not decoration. Everything must work with reduced motion.
- 3D belongs to marketing, the command-center hero, empty states and special visualizations
  only, always `next/dynamic` with `ssr: false`, paused offscreen, with a 2D fallback. Tables and
  settings stay fast and plain.

## 6. Accessibility

Semantic HTML, labelled controls (`Field` wires label/description/error), visible focus, keyboard
operability for every action, `aria-live` for changing status (task progress, stream state),
never information conveyed only by color or animation (status = color + text).

## 7. Components & pages

- Pages in `src/app/(app)/app/**/page.tsx` stay thin: export `metadata` and render a client
  feature component from `src/components/<feature>/`.
- `"use client"` only where interactivity is needed.
- Forms: react-hook-form + zod (`zodResolver`); mirror backend constraints, let the backend
  re-validate and map its 422 `fieldErrors`.
- Developer mode (`useUiStore().developerMode`) reveals ids, sequences, tool versions, raw event
  payloads (`JsonViewer`), request ids — hidden by default.
- Long lists (events, logs) are virtualized (`@tanstack/react-virtual`) beyond a few hundred rows.
- Heavy modules (3D, charts, markdown) are dynamically imported.

## 8. Testing & checks

`npm run typecheck && npm run lint && npm test` must pass. Unit/component tests live next to the
code (`*.test.ts(x)`) or in `tests/unit`. End-to-end tests (`tests/e2e`, Playwright) run against
the simulated backend (`backend/scripts/simulated_backend.py`), which executes real tasks with a
scripted model and a simulated Google Workspace.
