# AgentOS web — known limitations and backend gaps

The web app never fakes data the API does not provide. Where the product would benefit from
something the backend does not expose, the UI says so (or degrades honestly) and the gap is listed
here, so it can be closed at the source. Items marked **closed** were fixed in the backend while the
frontend was built.

## Closed during integration

- **closed** — Agent version author: `AgentVersionOut.created_by` / `created_by_name`.
- **closed** — Tool execution settings: `ToolOut.idempotency_strategy`, `timeout_seconds`,
  `max_attempts`, `parallel_safe`.
- **closed** — Google capability identifiers are a published enum (`GoogleCapability`); the web
  app types the connect request with it and a unit test fails if the presentation table misses one.
- **closed** — Lifecycle enums (task/step/verification/approval/connection/file/MCP/memory
  states, event types, permission codes) are published in the OpenAPI document; every status
  map in `src/lib/status` is exhaustive over them.

## Tasks and approvals

- Task and approval payloads carry no agent name or goal; the UI resolves agent names through
  `GET /agents` and fetches the task for each approval card.
- `TaskCreate` has no file field; attachments are uploaded first and referenced in `context`.
- Approvals cannot be filtered by "not pending"; history filters pending items out client-side.
- A paused task keeps its pending approval open (backend behaviour); the UI shows it as returned
  to the queue.
- The simulated backend has no scenario that produces `requires_reconciliation` or `expired`;
  those states are covered by component tests.

## Agents, tools, integrations, MCP

- Agent names cannot be changed (`AgentUpdate` has no `name`); the edit dialog says so.
- There is no endpoint listing available models, so model overrides are free text (validated by
  the backend).
- MCP re-approval shows the current definition and the old → new schema hash; the gateway keeps
  only the approved hash, not the previous definition, so no content diff is possible.
- There is no API to list stored credentials, so MCP registration accepts an auth header value
  only.
- The OAuth success redirect is fixed (`FRONTEND_OAUTH_SUCCESS_URL`), so connecting Google from the
  Tool Center returns to Integrations.

## Memory, search, files, automations

- There is no memory count endpoint; sections show no totals.
- Web search requires a configured provider (`SEARCH_PROVIDER`); without one the page explains
  how to enable it and offers document/memory search instead.
- The file list does not include extraction metadata (the detail call does), and the API does not
  expose why extraction failed.
- The server's upload size limit is not exposed; the client mirrors the 25 MB default and the
  backend enforces the real value.
- Manual automation runs do not increase the automation's run count ("Scheduled runs").
- The next-runs preview is computed in the browser; the scheduler's own next run is shown next
  to it.

## Settings, organization, usage, billing, labs, admin

- There is no "revoke all other sessions" endpoint; the UI revokes sessions one by one.
- Audit filters are exact-match only (no date range or text search).
- Daily usage depends on the scheduler's aggregation job; the page says when data is not yet
  aggregated.
- Plans are informational: the billing provider is `none` by default and there is no self-serve
  plan-change endpoint for owners. `max_members` is shown but not enforced by the backend.
- Canary limits (≤ 50 %) and the 24 h observation period are not exposed by the API; the UI shows
  the backend's messages, including the remaining time.
- Admin lists are capped at 200 rows without cursors; feature-flag overrides cannot be deleted.
- Evaluation runs have no live stream; pages poll while work is queued or running.

## Demo mode

`NEXT_PUBLIC_DEMO_MODE=true` runs an in-browser simulation of the API (one user, one
organization, state resets on reload, any credentials accepted). Admin endpoints, web search,
MFA, password change, account deletion, organization creation and direct file downloads answer
`501 not_available_in_demo`. Approval expiry, scheduled automation firing and post-task memory
extraction are not simulated.
