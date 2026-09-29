/** Tasks, approvals and the SSE streams (`/tasks/*`, `/approvals/*`, `/events/stream`). */
import type { ApprovalStatus } from "@/lib/api";
import { Body, type Ctx, json, notFound, paginate, queryBool, queryEnum, queryInt, queryUuid } from "../http";
import type { Router, Srv } from "../router";
import { taskEventStream, userEventStream } from "../sse";
import { approvalOut, buildSummary, taskDetail, taskOut } from "../views";
import { clone } from "../util";
import { requireStreamToken } from "./auth";
import { can, idempotent, requirePermission, requireTask } from "./common";

const keyed = <T extends { createdAt: string; id: string }>(t: T) => ({ ...t, created_at: t.createdAt });

async function createTask(ctx: Ctx, srv: Srv) {
  requirePermission(srv.store, "tasks:create");
  const raw = await ctx.json();
  const b = new Body(raw).forbidExtra(["goal", "agent_id", "context", "priority", "max_duration_seconds"]);
  const goal = b.str("goal", { min: 1, max: 4000 });
  const agentId = b.optUuid("agent_id");
  const context = b.optStr("context", { max: 8000 });
  const priority = b.optNum("priority", { int: true, min: 0, max: 1000 }) ?? 100;
  b.optNum("max_duration_seconds", { int: true, min: 30, max: 7 * 24 * 3600 });
  b.done();
  const key = ctx.header("idempotency-key");
  return idempotent(ctx, srv, raw, () => {
    const task = srv.engine.createTask(
      { goal, agentId, context, priority },
      { idempotencyKey: key, requestId: ctx.requestId },
    );
    return { status: 202, body: taskOut(task) };
  });
}

function listTasks(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "tasks:read");
  const status = ctx.query.get("status");
  const all = queryBool(ctx, "all_users") && can(store, "tasks:read_all");
  const rows = [...store.tasks.values()].filter(
    (t) => (all || t.userId === store.me.id) && (!status || t.status === status),
  );
  return json(ctx, 200, paginate(ctx, rows.map(keyed), taskOut));
}

function listEvents(ctx: Ctx, srv: Srv) {
  const task = requireTask(srv, ctx.params.task_id);
  const after = queryInt(ctx, "after_seq", 0, 0, Number.MAX_SAFE_INTEGER);
  const limit = queryInt(ctx, "limit", 100, 1, 500);
  const items = task.events
    .filter((e) => e.seq > after)
    .slice(0, limit)
    .map((e) => clone(e));
  return json(ctx, 200, { items, next_after_seq: items.length ? items[items.length - 1].seq : null });
}

function streamTask(ctx: Ctx, srv: Srv) {
  requireStreamToken(ctx, srv.store);
  const task = requireTask(srv, ctx.params.task_id);
  const lastId = Number.parseInt(ctx.header("last-event-id") ?? "0", 10);
  const body = taskEventStream({
    bus: srv.store.bus,
    taskId: task.id,
    afterSeq: Number.isFinite(lastId) && lastId > 0 ? lastId : 0,
    signal: ctx.request.signal,
    read: () => {
      const t = srv.store.tasks.get(task.id);
      return t ? { status: t.status, events: t.events } : null;
    },
  });
  return sseResponse(ctx, body);
}

function streamUser(ctx: Ctx, srv: Srv) {
  requireStreamToken(ctx, srv.store);
  return sseResponse(ctx, userEventStream({ bus: srv.store.bus, userId: srv.store.me.id, signal: ctx.request.signal }));
}

function sseResponse(ctx: Ctx, body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      "x-accel-buffering": "no",
      "x-request-id": ctx.requestId,
    },
  });
}

async function provideInput(ctx: Ctx, srv: Srv) {
  const task = requireTask(srv, ctx.params.task_id);
  requirePermission(srv.store, "tasks:cancel");
  const b = new Body(await ctx.json()).forbidExtra(["answer"]);
  const answer = b.str("answer", { min: 1, max: 4000 });
  b.done();
  return json(ctx, 200, taskOut(srv.engine.provideInput(task, answer, ctx.requestId)));
}

async function confirmStep(ctx: Ctx, srv: Srv) {
  const task = requireTask(srv, ctx.params.task_id);
  requirePermission(srv.store, "tasks:cancel");
  const b = new Body(await ctx.json()).forbidExtra(["outcome", "note"]);
  const outcome = b.enumOf("outcome", ["succeeded", "did_not_happen"] as const);
  const note = b.optStr("note", { max: 1000 });
  b.done();
  return json(ctx, 200, taskOut(srv.engine.confirmStep(task, ctx.params.step_id, outcome, note, ctx.requestId)));
}

const control = (op: "cancel" | "pause" | "resume") => (ctx: Ctx, srv: Srv) => {
  const task = requireTask(srv, ctx.params.task_id);
  requirePermission(srv.store, "tasks:cancel");
  return json(ctx, 200, taskOut(srv.engine[op](task, ctx.requestId)));
};

// ---------------------------------------------------------------------------- approvals
const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
] as const satisfies readonly ApprovalStatus[];

function visibleApproval(ctx: Ctx, { store }: Srv) {
  const approval = store.approvals.get(ctx.params.approval_id);
  if (!approval || (approval.user_id !== store.me.id && !can(store, "approvals:decide_any")))
    throw notFound("Approval not found");
  return approval;
}

function listApprovals(ctx: Ctx, { store }: Srv) {
  const status = queryEnum(ctx, "status", APPROVAL_STATUSES);
  const taskId = queryUuid(ctx, "task_id");
  const rows = [...store.approvals.values()].filter(
    (a) =>
      (a.user_id === store.me.id || can(store, "approvals:decide_any")) &&
      (!status || a.status === status) &&
      (!taskId || a.task_id === taskId),
  );
  return json(ctx, 200, paginate(ctx, rows, approvalOut));
}

async function approve(ctx: Ctx, srv: Srv) {
  const raw = await ctx.json();
  const b = new Body(raw, { optional: true });
  const note = b.optStr("note", { max: 1000 });
  b.done();
  const approval = visibleApproval(ctx, srv);
  return idempotent(ctx, srv, { note }, () => ({
    status: 200,
    body: approvalOut(srv.engine.approve(approval, note, ctx.requestId)),
  }));
}

async function reject(ctx: Ctx, srv: Srv) {
  const b = new Body(await ctx.json());
  const reason = b.str("reason", { min: 1, max: 1000 });
  b.done();
  const approval = visibleApproval(ctx, srv);
  return idempotent(ctx, srv, { reason }, () => ({
    status: 200,
    body: approvalOut(srv.engine.reject(approval, reason, ctx.requestId)),
  }));
}

export function taskRoutes(r: Router): void {
  r.add("GET", "/tasks", listTasks)
    .add("POST", "/tasks", createTask)
    .add("GET", "/tasks/{task_id}", (ctx, srv) =>
      json(ctx, 200, taskDetail(srv.store, requireTask(srv, ctx.params.task_id))),
    )
    .add("GET", "/tasks/{task_id}/summary", (ctx, srv) =>
      json(ctx, 200, buildSummary(srv.store, requireTask(srv, ctx.params.task_id))),
    )
    .add("GET", "/tasks/{task_id}/events", listEvents)
    .add("GET", "/tasks/{task_id}/logs", (ctx, srv) => {
      const task = requireTask(srv, ctx.params.task_id);
      return json(ctx, 200, task.logs.slice(0, queryInt(ctx, "limit", 200, 1, 1000)));
    })
    .add("GET", "/tasks/{task_id}/events/stream", streamTask, { public: true })
    .add("GET", "/events/stream", streamUser, { public: true })
    .add("POST", "/tasks/{task_id}/cancel", control("cancel"))
    .add("POST", "/tasks/{task_id}/pause", control("pause"))
    .add("POST", "/tasks/{task_id}/resume", control("resume"))
    .add("POST", "/tasks/{task_id}/input", provideInput)
    .add("POST", "/tasks/{task_id}/steps/{step_id}/confirm", confirmStep)
    .add("GET", "/approvals", listApprovals)
    .add("GET", "/approvals/{approval_id}", (ctx, srv) => json(ctx, 200, approvalOut(visibleApproval(ctx, srv))))
    .add("POST", "/approvals/{approval_id}/approve", approve)
    .add("POST", "/approvals/{approval_id}/reject", reject);
}
