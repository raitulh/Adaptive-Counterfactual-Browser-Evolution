# Backend conventions (read before adding a module)

AgentOS is a **modular monolith + durable workers**. Every domain module lives in
`app/<module>/` and owns its `models.py`, `schemas.py`, `service.py`, `router.py`
(and optionally `tools.py`, `jobs.py`). Cross-module calls go through the other
module's `service.py` functions — never its router, never its tables directly
when a service function exists.

Core principle: **LLM proposes. Backend decides. Tools execute. Verifier confirms.**

## Python / style

* Python 3.11, `from __future__ import annotations` in every module, full type hints.
* Pydantic v2 for every external input/output (API bodies, tool args, provider payloads,
  model JSON). `model_config = ConfigDict(extra="forbid")` on inputs that come from a model/client.
* Small focused functions, no giant classes, no global mutable state except the
  explicitly injectable process singletons (`get_x()` / `set_x()` pairs for tests).
* Lint: `ruff check app tests`, types: `mypy app`. Line length 110.

## Database

* SQLAlchemy 2.x async ORM. Base + mixins in `app/core/database.py`:
  `UUIDPrimaryKeyMixin` (UUIDv7), `TimestampMixin`, `SoftDeleteMixin`,
  `VersionedMixin` (optimistic locking), `TenantScopedMixin` (adds `tenant_id` FK → organizations).
* **Every tenant-owned table uses `TenantScopedMixin`.** The session guard in
  `app/core/database.py` automatically adds `tenant_id = :scope` to ORM SELECT/UPDATE/DELETE
  and raises `TenantScopeError` when a tenant-scoped entity is queried on a session
  that is neither tenant-scoped (`session.info["tenant_id"]`) nor explicitly system
  (`session.info["system"] = True`). Use `execution_options={"skip_tenant_scope": True}` only
  in reviewed system code (scheduler, maintenance, cross-tenant admin with audit).
* API requests get a tenant-scoped session from `app.api.dependencies.get_ctx`.
  Workers open sessions with `session.info["tenant_id"] = tenant_id` (or `system`).
* **Never hold a transaction open across network I/O** (model calls, Google, MCP,
  browser, HTTP). Pattern: persist intent (commit) → call external → persist outcome (commit).
* Register new model modules in `app/db_models.py` (`MODEL_MODULES`). Schema changes
  require an Alembic migration in `migrations/versions/` (never `create_all` in app code).
* JSON columns use `sqlalchemy.dialects.postgresql.JSONB`. Vectors use `pgvector.sqlalchemy.Vector`.
* Add indexes deliberately (tenant + lookup columns, state columns used by workers).

## Errors

* Raise typed errors from `app/core/exceptions.py` (`NotFound`, `Forbidden`, `ValidationFailed`,
  `Conflict`, `IntegrationError` family, `ToolError` family, `NeedsUserInput`, …).
  They render as `{"error": {"code","message","request_id","details"}}`.
* Messages must be user-safe: no secrets, no stack traces, no raw provider bodies.

## API

* Routers use `APIRouter(prefix="/<module>", tags=["<module>"])`, are mounted under `/api/v1`
  by `app/api/router.py`, and get the authenticated `RequestContext` via `Ctx` or
  `Depends(require(P.SOME_PERMISSION))` (see `app/organizations/rbac.py`).
* Never accept `tenant_id`/`user_id` from the client for authorization — use `ctx`.
* Cursor pagination: `app/common/pagination.py` (`apply_keyset`, `build_page`, `Page[T]`).
* Every endpoint has `summary=` and a `response_model`.
* Write endpoints that create things accept `Idempotency-Key` (`app/common/idempotency.py`).

## Audit, usage, notifications, events

* Sensitive operations: `app.audit.service.record(session, ctx=ctx, category=..., action=..., ...)`
  inside the same transaction as the change. Never put secrets in metadata (it is redacted anyway).
* Metering: `app.usage.service.add_usage(session, tenant_id=..., kind=UsageKind.X, ...)`.
* Notifications: `app.notifications.service.notify(...)` (idempotent via `idempotency_key`).
* Background work: `app.workers.queues.postgres.get_job_queue().enqueue(session, JobSpec(...))`
  inside the transaction that requires the work. Handlers: `@job("x.y")` in `app/<module>/jobs.py`
  (module listed in `app/workers/jobs/registry.py:HANDLER_MODULES`). Handlers must be idempotent.

## Tools

* Implement `app.tools.base.Tool[In, Out]` with a `ToolSpec` (name `domain.action`, version `v1`,
  permission level, risk level, scopes, idempotency strategy, timeout, retry policy,
  verification method, `output_trust`).
* Side-effecting tools **must** implement `verify()` (read-back / provider confirmation) and
  should implement `reconcile()` (did an unknown-outcome attempt take effect?).
* External content (web pages, e-mails, documents, MCP output, search results) is
  `TrustLevel.UNTRUSTED_EXTERNAL_CONTENT`: sanitize with `app.common.sanitize` and never let it
  change policy or tool authorization.
* Outbound HTTP to user/model/web-chosen URLs must use `app.security.http.safe_request` with an
  `EgressPolicy` (SSRF protection). Every external call has a timeout.
* Export tools via a module-level `TOOLS: list[Tool]` in a module listed in
  `app/tools/registry.py:BUILTIN_TOOL_MODULES`.

## Testing

* `pytest` + `pytest-asyncio` (auto mode). Unit tests in `tests/unit/`, DB/Redis tests in
  `tests/integration/` (marker `integration`), security tests in `tests/security/`.
* Shared fixtures live in `tests/conftest.py` (`db_session`, `client`, `make_user`, fake Google).
