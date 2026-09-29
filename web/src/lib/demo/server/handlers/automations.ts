/** Scheduled automations and their runs; "Run now" creates a real (simulated) task. */
import { CronExpressionParser } from "cron-parser";
import type { AutomationOut, AutomationRunOut } from "@/lib/api";
import { nextRun } from "../../fixtures/automations";
import { PLANS } from "../../fixtures/workspace";
import { Body, conflict, type Ctx, json, noContent, notFound, paginate } from "../http";
import type { Router, Srv } from "../router";
import type { DemoStore } from "../store";
import { clone, uuid } from "../util";
import { idempotent, requirePermission } from "./common";

function validateCron(b: Body, field: string, cron: string, timeZone: string): void {
  if (!cron) return;
  if (cron.trim().split(/\s+/).length !== 5) {
    b.fail(field, "Value error, cron_expression must have exactly 5 fields: minute hour day month weekday");
    return;
  }
  try {
    const it = CronExpressionParser.parse(cron, { tz: timeZone });
    const times = [it.next().getTime(), it.next().getTime(), it.next().getTime()];
    if (times[1] - times[0] < 15 * 60_000 || times[2] - times[1] < 15 * 60_000) {
      b.fail(field, "Value error, schedules may run at most every 15 minutes");
    }
  } catch {
    b.fail(field, "Value error, cron_expression is not a valid cron expression");
  }
}

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function templateOf(b: Body, required: boolean): Record<string, unknown> | null {
  const t = b.optObj("task_template");
  if (!t) {
    if (required) b.fail("task_template", "Field required", "missing");
    return null;
  }
  const goal = t.goal;
  if (typeof goal !== "string" || goal.trim().length < 1 || goal.length > 4000)
    b.fail("task_template.goal", "String should have at least 1 character", "string_too_short");
  for (const key of Object.keys(t)) {
    if (!["goal", "agent_id", "context", "priority", "max_duration_seconds"].includes(key))
      b.fail(`task_template.${key}`, "Extra inputs are not permitted", "extra_forbidden");
  }
  return { priority: 100, ...t };
}

function findAutomation(ctx: Ctx, store: DemoStore): AutomationOut {
  const a = store.automations.find((x) => x.id === ctx.params.automation_id);
  if (!a) throw notFound("Automation not found");
  return a;
}

async function create(ctx: Ctx, srv: Srv) {
  const { store } = srv;
  requirePermission(store, "automations:manage");
  const raw = await ctx.json();
  const b = new Body(raw).forbidExtra([
    "name",
    "cron_expression",
    "timezone",
    "enabled",
    "max_runs",
    "policy",
    "retry_policy",
    "task_template",
    "trigger_type",
  ]);
  const name = b.str("name", { min: 1, max: 200 });
  const tz = b.optStr("timezone", { max: 64 }) ?? "UTC";
  if (!validTimeZone(tz)) b.fail("timezone", "Value error, unknown time zone");
  const cron = b.str("cron_expression", { min: 9, max: 120 });
  validateCron(b, "cron_expression", cron, validTimeZone(tz) ? tz : "UTC");
  const enabled = b.optBool("enabled") ?? true;
  const maxRuns = b.optNum("max_runs", { int: true, min: 1, max: 100_000 });
  const policy = b.optObj("policy") ?? {};
  const retry = b.optObj("retry_policy") ?? {};
  const template = templateOf(b, true);
  b.optEnum("trigger_type", ["schedule"] as const);
  b.done();
  const plan = PLANS.find((p) => p.name === store.org.plan);
  if (plan && store.automations.length >= plan.max_automations)
    throw conflict(`Your plan allows ${plan.max_automations} automations.`, "automation_limit_reached");
  return idempotent(ctx, srv, raw, () => {
    const now = store.nowIso();
    const a: AutomationOut = {
      id: uuid(),
      name,
      cron_expression: cron.trim(),
      timezone: tz,
      trigger_type: "schedule",
      enabled,
      disabled_reason: null,
      task_template: template ?? {},
      policy: { max_consecutive_failures: 3, pause_on_failure: true, ...policy },
      retry_policy: { max_attempts: 3, backoff_seconds: 60, ...retry },
      max_runs: maxRuns,
      run_count: 0,
      consecutive_failures: 0,
      last_run_at: null,
      last_status: null,
      next_run_at: enabled ? nextRun(cron, tz, store.now()) : null,
      version: 1,
      created_at: now,
      updated_at: now,
    };
    store.automations.push(a);
    store.audit(
      { category: "automation", action: "automation.create", resource_type: "automation", resource_id: a.id },
      ctx.requestId,
    );
    return { status: 201, body: clone(a) };
  });
}

async function update(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "automations:manage");
  const b = new Body(await ctx.json());
  const a = findAutomation(ctx, store);
  const expected = b.optNum("expected_version", { int: true });
  const name = b.optStr("name", { min: 1, max: 200 });
  const tz = b.optStr("timezone", { max: 64 });
  if (tz && !validTimeZone(tz)) b.fail("timezone", "Value error, unknown time zone");
  const cron = b.optStr("cron_expression", { min: 9, max: 120 });
  if (cron) validateCron(b, "cron_expression", cron, tz && validTimeZone(tz) ? tz : a.timezone);
  const enabled = b.optBool("enabled");
  const maxRuns = b.optNum("max_runs", { int: true, min: 1, max: 100_000 });
  const policy = b.optObj("policy");
  const retry = b.optObj("retry_policy");
  const template = templateOf(b, false);
  b.done();
  if (expected !== null && expected !== a.version) {
    throw conflict("The automation was modified concurrently; reload and retry.", "version_conflict", {
      current_version: a.version,
    });
  }
  if (name) a.name = name;
  if (tz) a.timezone = tz;
  if (cron) a.cron_expression = cron.trim();
  if (b.has("max_runs")) a.max_runs = maxRuns;
  if (policy) a.policy = { ...a.policy, ...policy };
  if (retry) a.retry_policy = { ...a.retry_policy, ...retry };
  if (template) a.task_template = template;
  if (enabled !== null) {
    a.enabled = enabled;
    if (enabled) {
      a.disabled_reason = null;
      a.consecutive_failures = 0;
    } else {
      a.disabled_reason = "Paused by user";
    }
  }
  a.next_run_at = a.enabled ? nextRun(a.cron_expression, a.timezone, store.now()) : null;
  a.version += 1;
  a.updated_at = store.nowIso();
  store.audit(
    {
      category: "automation",
      action: "automation.update",
      resource_type: "automation",
      resource_id: a.id,
      metadata: { version: a.version },
    },
    ctx.requestId,
  );
  return json(ctx, 200, clone(a));
}

function runNow(ctx: Ctx, { store, engine }: Srv) {
  requirePermission(store, "automations:manage");
  const a = findAutomation(ctx, store);
  if (a.max_runs !== null && a.run_count >= a.max_runs)
    throw conflict("This automation reached its maximum number of runs.", "max_runs_reached");
  const now = store.nowIso();
  const run: AutomationRunOut = {
    id: uuid(),
    automation_id: a.id,
    scheduled_for: now,
    trigger: "manual",
    status: "created",
    attempts: 1,
    error: null,
    next_attempt_at: null,
    task_id: null,
    created_at: now,
    finished_at: null,
  };
  store.automationRuns.push(run);
  const t = a.task_template as { goal?: string; agent_id?: string | null; context?: string | null; priority?: number };
  const task = engine.createTask(
    {
      goal: String(t.goal ?? a.name),
      agentId: t.agent_id ?? null,
      context: t.context ?? null,
      priority: t.priority ?? 100,
    },
    { source: "automation", automationRunId: run.id, requestId: ctx.requestId },
  );
  run.task_id = task.id;
  a.run_count += 1;
  a.last_run_at = now;
  a.last_status = "created";
  store.addUsage("automation_run");
  store.audit(
    {
      category: "automation",
      action: "automation.run_now",
      resource_type: "automation",
      resource_id: a.id,
      task_id: task.id,
    },
    ctx.requestId,
  );
  return json(ctx, 202, clone(run));
}

export function automationRoutes(r: Router): void {
  r.add("GET", "/automations", (ctx, { store }) => json(ctx, 200, paginate(ctx, store.automations, clone)))
    .add("POST", "/automations", create)
    .add("GET", "/automations/{automation_id}", (ctx, { store }) => json(ctx, 200, clone(findAutomation(ctx, store))))
    .add("PATCH", "/automations/{automation_id}", update)
    .add("DELETE", "/automations/{automation_id}", (ctx, { store }) => {
      requirePermission(store, "automations:manage");
      const a = findAutomation(ctx, store);
      store.automations = store.automations.filter((x) => x !== a);
      store.audit(
        { category: "automation", action: "automation.delete", resource_type: "automation", resource_id: a.id },
        ctx.requestId,
      );
      return noContent(ctx);
    })
    .add("GET", "/automations/{automation_id}/runs", (ctx, { store }) => {
      const a = findAutomation(ctx, store);
      return json(
        ctx,
        200,
        paginate(
          ctx,
          store.automationRuns.filter((x) => x.automation_id === a.id),
          clone,
        ),
      );
    })
    .add("POST", "/automations/{automation_id}/run-now", runNow);
}
