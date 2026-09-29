/**
 * The demo's task runtime — a faithful, compact port of the backend's planner
 * (`app/planner/service.py`), execution engine (`app/execution/engine.py`), task service
 * (`app/tasks/service.py`) and approval engine (`app/approvals/service.py`):
 *
 *   created → planning → planned → validating → queued → running
 *     → (waiting_approval | waiting_input | retry → queued) … → verifying → completed
 *
 * Every transition goes through the real state tables and appends the same events with the same
 * payloads. Approvals really gate execution (bound to an action hash, consumed once); failures go
 * through the recovery planner (retry with backoff / ask the user / block / fail); a step completes
 * only after verification, and the task only after a final verification.
 *
 * All waiting happens on `store.sched`, so the same code runs live (real timers) and on the virtual
 * clock that generates the seeded history.
 */
import type { EventType, NotificationEvent, StepStatus, TaskStatus } from "@/lib/api";
import { latency } from "./clock";
import { conflict, DemoHttpError, notFound, unprocessable } from "./http";
import { planFor, type Plan } from "./scenarios";
import { STEP_TERMINAL, STEP_TRANSITIONS, TASK_ACTIVE, TASK_TRANSITIONS } from "./states";
import type { ApprovalRec, DemoStore, StepRec, TaskRec } from "./store";
import {
  assess,
  decideRecovery,
  describeAction,
  evaluatePermission,
  hasSideEffects,
  toolSim,
  toolTarget,
  TOOLS,
  ToolFailure,
  type ToolResult,
} from "./tools";
import { buildSummary } from "./views";
import { hash64, iso, random, uuid } from "./util";

const SKIP_MESSAGE = "Skipped because a step it depends on did not complete.";
const MAX_PARALLEL = 4;
const EVENT_FOR_STATUS: Partial<Record<TaskStatus, EventType>> = {
  completed: "TASK_COMPLETED",
  failed: "TASK_FAILED",
  cancelled: "TASK_CANCELLED",
  paused: "TASK_PAUSED",
  cancel_requested: "CANCEL_REQUESTED",
};

interface Runtime {
  driving: boolean;
  rerun: boolean;
  execAt: number | null;
  cancelExec: (() => void) | null;
  cancelPlan: (() => void) | null;
}

type Done = () => void;

function join(jobs: ((done: Done) => void)[], then: Done): void {
  let left = jobs.length;
  if (left === 0) return then();
  for (const job of jobs) {
    job(() => {
      left -= 1;
      if (left === 0) then();
    });
  }
}

// ---------------------------------------------------------------------------- references
const REF = /^steps\.([a-z][a-z0-9_]{0,40})\.output(?:\.([A-Za-z0-9_.-]+))?$/;
const TEMPLATE = /\{\{\s*(steps\.[a-z][a-z0-9_]{0,40}\.output(?:\.[A-Za-z0-9_.-]+)?)\s*\}\}/g;

class UnresolvableReference extends ToolFailure {
  constructor(message: string) {
    super("invalid_input", "unresolvable_reference", message);
  }
}

const isRef = (v: unknown): v is { $ref: string } =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.keys(v).length === 1 &&
  typeof (v as { $ref?: unknown }).$ref === "string";

function lookup(expr: string, outputs: Map<string, Record<string, unknown>>): unknown {
  const m = REF.exec(expr.trim());
  if (!m) throw new UnresolvableReference(`Malformed reference '${expr.slice(0, 100)}'`);
  if (!outputs.has(m[1])) throw new UnresolvableReference(`Step '${m[1]}' has no output yet`);
  let cur: unknown = outputs.get(m[1]);
  for (const part of (m[2] ?? "").split(".").filter(Boolean)) {
    if (Array.isArray(cur) && /^\d+$/.test(part) && Number(part) < cur.length) cur = cur[Number(part)];
    else if (cur && typeof cur === "object" && !Array.isArray(cur) && part in cur)
      cur = (cur as Record<string, unknown>)[part];
    else throw new UnresolvableReference(`Reference '${expr}' names a missing field '${part}'`);
  }
  return cur;
}

function resolveRefs(value: unknown, outputs: Map<string, Record<string, unknown>>): unknown {
  if (isRef(value)) return lookup(value.$ref, outputs);
  if (Array.isArray(value)) return value.map((v) => resolveRefs(v, outputs));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, outputs)]));
  }
  if (typeof value === "string" && value.includes("{{")) {
    return value.replace(TEMPLATE, (_, expr: string) => {
      const r = lookup(expr, outputs);
      return typeof r === "object" ? JSON.stringify(r) : String(r);
    });
  }
  return value;
}

function collectRefs(value: unknown, out = new Set<string>()): Set<string> {
  if (isRef(value)) {
    const m = REF.exec(value.$ref.trim());
    if (m) out.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => collectRefs(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectRefs(v, out));
  else if (typeof value === "string") for (const m of value.matchAll(TEMPLATE)) collectRefs({ $ref: m[1] }, out);
  return out;
}

/** Plan-time stand-in for values that only exist after earlier steps ran. */
function placeholders(value: unknown): unknown {
  if (isRef(value)) return "unresolved@pending.invalid";
  if (Array.isArray(value)) return value.map(placeholders);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, placeholders(v)]));
  return value;
}

// ---------------------------------------------------------------------------- engine
export class DemoEngine {
  private runtimes = new Map<string, Runtime>();

  constructor(private readonly store: DemoStore) {}

  private rt(task: TaskRec): Runtime {
    let r = this.runtimes.get(task.id);
    if (!r) {
      r = { driving: false, rerun: false, execAt: null, cancelExec: null, cancelPlan: null };
      this.runtimes.set(task.id, r);
    }
    return r;
  }

  private get now(): number {
    return this.store.now();
  }

  private timeZone(): string {
    return this.store.me.timezone || "UTC";
  }

  // ------------------------------------------------------------------ transitions
  transition(
    task: TaskRec,
    target: TaskStatus,
    reason: string | null,
    opts: { actorType?: string; payload?: Record<string, unknown> } = {},
  ) {
    const current = task.status;
    if (current === target) return;
    if (!TASK_TRANSITIONS[current].includes(target)) {
      throw conflict(`Task cannot move from ${current} to ${target}`, "invalid_state_transition", {
        from: current,
        to: target,
      });
    }
    task.status = target;
    const now = this.store.nowIso();
    if (target === "running" && !task.startedAt) task.startedAt = now;
    if (target === "completed" || target === "failed" || target === "cancelled" || target === "expired")
      task.completedAt = now;
    this.store.appendEvent(task, EVENT_FOR_STATUS[target] ?? "TASK_STATE_CHANGED", {
      payload: { from: current, to: target, reason, ...(opts.payload ?? {}) },
      actorType: opts.actorType ?? "system",
    });
  }

  private forceStatus(task: TaskRec, target: TaskStatus, reason: string) {
    if (task.status === target) return;
    if (!TASK_TRANSITIONS[task.status].includes(target) && TASK_TRANSITIONS[task.status].includes("running")) {
      this.transition(task, "running", reason);
    }
    this.transition(task, target, reason);
  }

  private stepTo(step: StepRec, target: StepStatus) {
    if (step.status === target) return;
    if (!STEP_TRANSITIONS[step.status].includes(target)) {
      throw conflict(`Step cannot move from ${step.status} to ${target}`, "invalid_state_transition", {
        from: step.status,
        to: target,
        step: step.key,
      });
    }
    step.status = target;
    const now = this.store.nowIso();
    if (target === "running" && !step.startedAt) step.startedAt = now;
    if (STEP_TERMINAL.has(target)) step.completedAt = now;
  }

  private notify(
    task: TaskRec,
    event: NotificationEvent,
    title: string,
    body: string,
    idemKey: string,
    data: Record<string, unknown> = {},
  ) {
    this.store.notify(task.userId, event, title, body, { task_id: task.id, ...data }, idemKey);
  }

  // ------------------------------------------------------------------ scheduling ("job queue")
  private enqueuePlan(task: TaskRec) {
    const r = this.rt(task);
    r.cancelPlan?.();
    r.cancelPlan = this.store.sched.after(latency(250, 600), () => {
      r.cancelPlan = null;
      this.plan(task);
    });
  }

  enqueueExecute(task: TaskRec, delayMs = latency(200, 450)) {
    const r = this.rt(task);
    const at = this.now + delayMs;
    if (r.cancelExec && r.execAt !== null && r.execAt <= at) return; // dedupe: an earlier run is already queued
    r.cancelExec?.();
    r.execAt = at;
    r.cancelExec = this.store.sched.after(delayMs, () => {
      r.cancelExec = null;
      r.execAt = null;
      this.drive(task);
    });
  }

  // ------------------------------------------------------------------ task service (API use-cases)
  createTask(
    input: { goal: string; agentId: string | null; context: string | null; priority: number },
    opts: {
      source?: "api" | "automation";
      automationRunId?: string | null;
      idempotencyKey?: string | null;
      requestId?: string | null;
      userId?: string;
    } = {},
  ): TaskRec {
    const store = this.store;
    const userId = opts.userId ?? store.me.id;
    const limit = Math.min(10, store.policy.policy.max_concurrent_tasks ?? 10);
    const active = [...store.tasks.values()].filter((t) => t.userId === userId && TASK_ACTIVE.has(t.status)).length;
    if (active >= limit) {
      throw new DemoHttpError(
        429,
        "too_many_active_tasks",
        `You already have ${active} active tasks (limit ${limit}).`,
        { limit },
      );
    }
    let agentId: string | null = null;
    let agentVersionId: string | null = null;
    let agentLabel: Record<string, unknown> = { label: "builtin-default:v1" };
    if (input.agentId) {
      const agent = store.agents.find((a) => a.id === input.agentId && !a.deleted);
      if (!agent) throw notFound("Agent not found");
      if (agent.status !== "active") throw conflict("The agent is disabled", "agent_disabled");
      const version = store.agentVersions.find((v) => v.id === agent.current_version_id);
      agentId = agent.id;
      agentVersionId = version?.id ?? null;
      agentLabel = {
        label: `${agent.name}:v${version?.version_number ?? 1}`,
        agent_id: agent.id,
        version_number: version?.version_number ?? 1,
      };
    }
    const now = store.nowIso();
    const task: TaskRec = {
      id: uuid(),
      userId,
      agentId,
      agentVersionId,
      agentLabel,
      goal: input.goal.trim(),
      context: input.context,
      priority: input.priority,
      source: opts.source ?? "api",
      idempotencyKey: opts.idempotencyKey ?? null,
      automationRunId: opts.automationRunId ?? null,
      status: "created",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      progress: 0,
      planVersion: 0,
      plan: null,
      modelCalls: 0,
      toolCalls: 0,
      failureCode: null,
      failureMessage: null,
      pendingQuestions: null,
      resultSummary: null,
      userInputs: [],
      pendingInput: null,
      cancelRequested: false,
      pauseRequested: false,
      replans: 0,
      policyVersion: null,
      events: [],
      logs: [],
      sim: { flakyFailures: 0 },
    };
    store.tasks.set(task.id, task);
    store.appendEvent(task, "TASK_CREATED", {
      actorType: opts.source === "automation" ? "scheduler" : "user",
      payload: { source: task.source },
    });
    store.addUsage("task_created");
    store.audit(
      {
        category: "task",
        action: "task.create",
        user_id: userId,
        actor_type: opts.source === "automation" ? "scheduler" : "user",
        task_id: task.id,
        resource_type: "task",
        resource_id: task.id,
        metadata: { source: task.source },
      },
      opts.requestId ?? null,
    );
    this.enqueuePlan(task);
    return task;
  }

  cancel(task: TaskRec, requestId: string | null = null): TaskRec {
    if (task.status === "completed" || task.status === "cancelled") {
      throw conflict(`Task is already ${task.status}`, "task_terminal");
    }
    task.cancelRequested = true;
    const resting: TaskStatus[] = [
      "created",
      "queued",
      "waiting_approval",
      "waiting_input",
      "paused",
      "blocked",
      "failed",
      "expired",
    ];
    if (resting.includes(task.status)) {
      for (const st of this.store.stepsOf(task)) {
        if (["pending", "waiting_approval", "waiting_input", "retry_scheduled", "blocked"].includes(st.status))
          this.stepTo(st, "cancelled");
      }
      this.cancelApprovals(task);
      this.transition(task, "cancelled", "cancelled by user", { actorType: "user" });
      task.resultSummary = buildSummary(this.store, task) as unknown as Record<string, unknown>;
    } else if (task.status !== "cancel_requested") {
      this.transition(task, "cancel_requested", "cancel requested", { actorType: "user" });
      this.enqueueExecute(task, 50);
    }
    this.store.audit({ category: "task", action: "task.cancel", task_id: task.id }, requestId);
    return task;
  }

  pause(task: TaskRec, requestId: string | null = null): TaskRec {
    if (task.status === "queued" || task.status === "waiting_approval") {
      this.transition(task, "paused", "paused by user", { actorType: "user" });
    } else if (task.status === "running" || task.status === "verifying" || task.status === "recovering") {
      task.pauseRequested = true; // honoured at the next safe boundary
    } else {
      throw conflict(`A ${task.status} task cannot be paused`, "invalid_state_transition");
    }
    this.store.audit({ category: "task", action: "task.pause", task_id: task.id }, requestId);
    return task;
  }

  resume(task: TaskRec, requestId: string | null = null): TaskRec {
    const resumable: TaskStatus[] = ["paused", "expired", "blocked", "failed", "requires_reconciliation"];
    if (!resumable.includes(task.status))
      throw conflict(`A ${task.status} task cannot be resumed`, "invalid_state_transition");
    if (task.planVersion === 0) {
      if (task.status !== "failed" && task.status !== "blocked")
        throw conflict("This task has no plan to resume", "invalid_state_transition");
      task.failureCode = task.failureMessage = null;
      this.transition(task, "planning", "resumed; re-planning", { actorType: "user" });
      this.enqueuePlan(task);
      this.store.audit({ category: "task", action: "task.resume", task_id: task.id }, requestId);
      return task;
    }
    let reopened = false;
    for (const st of this.store.stepsOf(task)) {
      if ((st.status === "blocked" || st.status === "failed") && st.errorClass !== "policy_blocked") {
        this.stepTo(st, "pending");
        st.errorClass = st.errorCode = st.errorMessage = null;
        reopened = true;
      } else if (st.status === "waiting_approval") {
        this.stepTo(st, "pending"); // a fresh approval is requested (or the pending one reused)
      } else if (st.status === "requires_reconciliation") {
        st.errorCode = null;
      } else if (st.status === "skipped" && reopened && st.errorMessage === SKIP_MESSAGE) {
        this.stepTo(st, "pending");
        st.completedAt = null;
        st.errorMessage = null;
      }
    }
    task.failureCode = task.failureMessage = null;
    task.pauseRequested = false;
    this.transition(task, "queued", "resumed by user", { actorType: "user" });
    this.store.appendEvent(task, "TASK_RESUMED", { actorType: "user" });
    this.enqueueExecute(task);
    this.store.audit({ category: "task", action: "task.resume", task_id: task.id }, requestId);
    return task;
  }

  provideInput(task: TaskRec, answer: string, requestId: string | null = null): TaskRec {
    if (task.status !== "waiting_input") throw conflict("The task is not waiting for input", "not_waiting_for_input");
    const question = task.pendingQuestions?.[0] ?? "(question)";
    const pending = task.pendingInput;
    let resolved: { step: StepRec; result: ToolResult } | null = null;
    if (pending) {
      const step = this.store.steps.get(pending.stepId);
      const sim = step ? toolSim(step.tool) : undefined;
      if (step && step.status === "waiting_input" && step.planVersion === task.planVersion && sim?.fromUserInput) {
        try {
          resolved = { step, result: sim.fromUserInput(step.resolvedArgs ?? step.arguments, answer) };
        } catch (err) {
          if (err instanceof ToolFailure) throw unprocessable(err.message, "validation_failed", err.details);
          throw err;
        }
      }
    }
    task.userInputs.push({ question, answer, at: this.store.nowIso() });
    task.pendingInput = null;
    task.pendingQuestions = null;
    this.store.appendEvent(task, "INPUT_RECEIVED", {
      actorType: "user",
      payload: { question: question.slice(0, 300) },
    });
    if (resolved) {
      const { step, result } = resolved;
      this.stepTo(step, "pending");
      this.stepTo(step, "running");
      step.output = result.output;
      step.outputSummary = result.summary;
      step.outputTrust = "controlled_agent_output";
      this.stepTo(step, "verifying");
      this.stepTo(step, "completed");
      step.verificationStatus = "passed";
      step.verificationMethod = "user_input";
      step.errorClass = step.errorCode = step.errorMessage = null;
      this.addVerification(task, step, "user_input", {}, {}, { source: "answer provided by the user" });
      this.store.appendEvent(task, "STEP_COMPLETED", {
        stepId: step.id,
        payload: { step: step.key, summary: result.summary, source: "user" },
      });
      this.updateProgress(task);
      this.transition(task, "queued", "input received", { actorType: "user" });
      this.enqueueExecute(task);
    } else {
      this.transition(task, "planning", "re-planning with user input", { actorType: "user" });
      this.enqueuePlan(task);
    }
    this.store.audit({ category: "task", action: "task.input", task_id: task.id }, requestId);
    return task;
  }

  confirmStep(
    task: TaskRec,
    stepId: string,
    outcome: "succeeded" | "did_not_happen",
    note: string | null,
    requestId: string | null = null,
  ) {
    const step = this.store.steps.get(stepId);
    if (!step || step.taskId !== task.id || step.status !== "requires_reconciliation") {
      throw conflict("This step is not awaiting confirmation", "step_not_awaiting_confirmation");
    }
    if (outcome === "succeeded") {
      this.stepTo(step, "completed");
      step.verificationStatus = "passed";
      step.verificationMethod = "user_confirmation";
      this.addVerification(task, step, "user_confirmation", {}, {}, { confirmed_by: this.store.me.id, note });
    } else {
      this.stepTo(step, "pending");
    }
    step.errorClass = step.errorCode = step.errorMessage = null;
    this.store.appendEvent(task, "RECONCILIATION_RESOLVED", {
      stepId: step.id,
      actorType: "user",
      payload: { step: step.key, outcome },
    });
    if (task.status === "requires_reconciliation") {
      this.transition(task, "queued", "user confirmed outcome", { actorType: "user" });
      this.enqueueExecute(task);
    }
    this.store.audit(
      { category: "task", action: "task.step.confirm", task_id: task.id, step_id: step.id, metadata: { outcome } },
      requestId,
    );
    return task;
  }

  // ------------------------------------------------------------------ approvals
  approve(approval: ApprovalRec, note: string | null, requestId: string | null = null): ApprovalRec {
    const task = this.store.tasks.get(approval.task_id)!;
    if (approval.status !== "pending") throw conflict(`Approval is already ${approval.status}`, "approval_not_pending");
    if (Date.parse(approval.expires_at) <= this.now) {
      approval.status = "expired";
      throw conflict("Approval has expired", "approval_expired");
    }
    if (task.status === "cancelled" || task.status === "completed" || task.status === "cancel_requested") {
      throw conflict("Task is no longer active", "task_not_active");
    }
    approval.status = "approved";
    approval.approved_by = this.store.me.id;
    approval.approved_at = this.store.nowIso();
    const step = this.store.steps.get(approval.step_id)!;
    if (step.status === "waiting_approval") this.stepTo(step, "pending");
    this.store.appendEvent(task, "APPROVAL_GRANTED", {
      stepId: step.id,
      actorType: "user",
      payload: { approval_id: approval.id, ...(note ? { note } : {}) },
    });
    if (task.status === "waiting_approval") this.transition(task, "queued", "approval granted", { actorType: "user" });
    this.enqueueExecute(task);
    this.store.audit(
      {
        category: "approval",
        action: "approval.approved",
        task_id: task.id,
        step_id: step.id,
        tool_name: approval.tool_name,
        approval_id: approval.id,
        resource_type: "approval",
        resource_id: approval.id,
        metadata: { risk_level: approval.risk_level },
      },
      requestId,
    );
    return approval;
  }

  reject(approval: ApprovalRec, reason: string, requestId: string | null = null): ApprovalRec {
    const task = this.store.tasks.get(approval.task_id)!;
    if (approval.status !== "pending") throw conflict(`Approval is already ${approval.status}`, "approval_not_pending");
    approval.status = "rejected";
    approval.rejected_by = this.store.me.id;
    approval.rejected_at = this.store.nowIso();
    approval.rejection_reason = reason;
    const step = this.store.steps.get(approval.step_id)!;
    if (step.status === "waiting_approval" || step.status === "pending") {
      this.stepTo(step, "failed");
      step.errorClass = "policy_blocked";
      step.errorCode = "approval_rejected";
      step.errorMessage = `Rejected by user: ${reason.slice(0, 500)}`;
    }
    this.store.appendEvent(task, "APPROVAL_REJECTED", {
      stepId: step.id,
      actorType: "user",
      payload: { approval_id: approval.id, reason: reason.slice(0, 500) },
    });
    if (task.status === "waiting_approval") {
      this.transition(task, "queued", "approval rejected; finalizing", { actorType: "user" });
      this.enqueueExecute(task);
    }
    this.store.audit(
      {
        category: "approval",
        action: "approval.rejected",
        task_id: task.id,
        step_id: step.id,
        tool_name: approval.tool_name,
        approval_id: approval.id,
        resource_type: "approval",
        resource_id: approval.id,
        metadata: { reason: reason.slice(0, 300) },
      },
      requestId,
    );
    return approval;
  }

  private cancelApprovals(task: TaskRec) {
    for (const a of this.store.approvals.values())
      if (a.task_id === task.id && a.status === "pending") a.status = "cancelled";
  }

  private requestApproval(
    task: TaskRec,
    step: StepRec,
    args: Record<string, unknown>,
    risk: string,
    level: string,
    reasons: string[],
  ) {
    const existing = [...this.store.approvals.values()].find(
      (a) => a.step_id === step.id && a.actionHash === step.actionHash && a.status === "pending",
    );
    if (existing) return existing;
    const spec = TOOLS.get(step.tool)!;
    const ttl = this.store.policy.policy.approval_ttl_seconds ?? 24 * 3600;
    const approval: ApprovalRec = {
      id: uuid(),
      task_id: task.id,
      step_id: step.id,
      user_id: task.userId,
      action: spec.name,
      tool_name: spec.name,
      summary: describeAction(spec, args).slice(0, 2000),
      target: toolTarget(spec, args),
      arguments_preview: JSON.parse(JSON.stringify(args)) as Record<string, unknown>,
      actionHash: step.actionHash!,
      risk_level: risk as ApprovalRec["risk_level"],
      permission_level: level as ApprovalRec["permission_level"],
      reasons: [...reasons],
      status: "pending",
      expires_at: iso(this.now + ttl * 1000),
      created_at: this.store.nowIso(),
      approved_at: null,
      approved_by: null,
      consumed_at: null,
      rejected_at: null,
      rejected_by: null,
      rejection_reason: null,
    };
    this.store.approvals.set(approval.id, approval);
    step.approvalRequestId = approval.id;
    this.store.appendEvent(task, "APPROVAL_REQUIRED", {
      stepId: step.id,
      payload: {
        approval_id: approval.id,
        summary: approval.summary,
        risk_level: risk,
        expires_at: approval.expires_at,
      },
    });
    this.notify(task, "approval_required", "Approval needed", approval.summary, `approval:${approval.id}`, {
      approval_id: approval.id,
    });
    this.store.audit({
      category: "approval",
      action: "approval.requested",
      actor_type: "worker",
      user_id: task.userId,
      task_id: task.id,
      step_id: step.id,
      tool_name: spec.name,
      approval_id: approval.id,
      resource_type: "approval",
      resource_id: approval.id,
      metadata: { risk_level: risk, reasons },
    });
    return approval;
  }

  // ------------------------------------------------------------------ planning
  private plan(task: TaskRec) {
    if (task.cancelRequested) return;
    if (task.status === "created") this.transition(task, "planning", "planning started");
    else if (task.status !== "planning") return;
    this.store.appendEvent(task, "PLANNING_STARTED", { payload: { replan: task.planVersion > 0 } });
    this.store.sched.after(latency(1100, 2200), () => this.persistPlan(task));
  }

  private toolPolicy(task: TaskRec): { allowed?: string[]; denied?: string[] } {
    const version = this.store.agentVersions.find((v) => v.id === task.agentVersionId);
    return version?.tool_policy ?? { allowed: ["*"], denied: [] };
  }

  private persistPlan(task: TaskRec) {
    const store = this.store;
    task.modelCalls += 1;
    store.addUsage("model_call", 1, 0.011);
    store.addUsage("model_input_tokens", 2400 + Math.round(random() * 900));
    store.addUsage("model_output_tokens", 380 + Math.round(random() * 240));
    if (task.cancelRequested || task.status === "cancel_requested") {
      if (task.status !== "cancelled") this.transition(task, "cancelled", "cancelled during planning");
      return;
    }
    if (task.status !== "planning") return;
    const plan = planFor(task.goal, task.userInputs.map((a) => a.answer).join("\n"));
    const toolPolicy = this.toolPolicy(task);
    const issues: { code: string; message: string; step_id: string | null }[] = [];
    const decisions = plan.steps.map((s) => {
      const spec = TOOLS.get(s.tool);
      if (!spec) {
        issues.push({
          code: "unknown_tool",
          message: `Step '${s.step_id}': tool '${s.tool}' does not exist`,
          step_id: s.step_id,
        });
        return null;
      }
      const d = evaluatePermission(store, spec, {
        assessment: assess(spec, placeholders(s.arguments) as Record<string, unknown>, store.policy.policy),
        toolPolicy,
        modelAsked: s.requires_approval,
      });
      if (d.decision === "deny")
        issues.push({
          code: "permission_denied",
          message: `Step '${s.step_id}': ${d.reasons[d.reasons.length - 1]}`,
          step_id: s.step_id,
        });
      return d;
    });
    if (issues.length) return this.rejectPlan(task, issues);
    if (plan.needs_user_input.length) {
      task.pendingQuestions = plan.needs_user_input.slice(0, 5);
      task.pendingInput = null;
      this.transition(task, "waiting_input", "planner needs information", {
        payload: { questions: task.pendingQuestions },
      });
      store.appendEvent(task, "INPUT_REQUIRED", { payload: { questions: task.pendingQuestions } });
      this.notify(
        task,
        "input_required",
        "Your task needs more information",
        task.pendingQuestions.join("; "),
        `plan-input:${task.id}:${task.events.length}`,
      );
      return;
    }
    this.transition(task, "planned", "plan created");
    for (const old of store.stepsOf(task)) {
      if (["pending", "waiting_approval", "waiting_input", "blocked"].includes(old.status)) {
        this.stepTo(old, old.status === "waiting_approval" ? "cancelled" : "skipped");
        old.errorMessage = "Superseded by a new plan.";
      }
    }
    this.cancelApprovals(task);
    const version = task.planVersion + 1;
    plan.steps.forEach((s, i) => {
      const spec = TOOLS.get(s.tool)!;
      const d = decisions[i]!;
      const step: StepRec = {
        id: uuid(),
        taskId: task.id,
        planVersion: version,
        key: s.step_id,
        position: i,
        action: s.action,
        tool: spec.name,
        toolVersion: spec.version,
        arguments: s.arguments,
        dependencies: s.dependencies,
        modelRequiresApproval: s.requires_approval,
        permissionLevel: d.level,
        riskLevel: d.risk,
        requiresApproval: d.decision === "require_approval",
        policyReasons: d.reasons,
        verificationMethod: spec.verification_method,
        status: "pending",
        attemptCount: 0,
        maxAttempts: spec.max_attempts,
        startedAt: null,
        completedAt: null,
        nextAttemptAt: null,
        resolvedArgs: null,
        actionHash: null,
        output: null,
        outputSummary: null,
        outputTrust: null,
        externalRef: null,
        errorClass: null,
        errorCode: null,
        errorMessage: null,
        verificationStatus: "pending",
        approvalRequestId: null,
      };
      store.steps.set(step.id, step);
    });
    task.planVersion = version;
    task.plan = this.planRecord(plan);
    task.policyVersion = store.policy.version;
    task.pendingQuestions = null;
    task.sim.flakyFailures = plan.flakyCalendarFailures;
    store.appendEvent(task, "PLAN_CREATED", {
      payload: { plan_version: version, steps: plan.steps.length, summary: plan.summary.slice(0, 500) },
    });
    this.transition(task, "validating", "validating plan");
    const approvalsExpected = decisions.filter((d) => d?.decision === "require_approval").length;
    this.store.sched.after(latency(350, 700), () => {
      if (task.status !== "validating") return;
      store.appendEvent(task, "PLAN_VALIDATED", {
        payload: { plan_version: version, approvals_expected: approvalsExpected },
      });
      this.transition(task, "queued", "plan validated");
      this.enqueueExecute(task);
      store.audit({
        category: "task",
        action: "task.planned",
        actor_type: "worker",
        user_id: task.userId,
        task_id: task.id,
        metadata: { plan_version: version, steps: plan.steps.length, model: "agentos-demo-planner" },
      });
    });
  }

  private planRecord(plan: Plan): Record<string, unknown> {
    return {
      goal: plan.goal,
      summary: plan.summary,
      steps: plan.steps.map((s) => ({
        ...s,
        tool_version: null,
        expected_result: null,
        timeout_seconds: null,
        retry_policy: null,
        verification_method: s.verification_method ?? null,
      })),
      dependencies: Object.fromEntries(plan.steps.map((s) => [s.step_id, s.dependencies])),
      model_labels: Object.fromEntries(
        plan.steps.map((s) => [s.step_id, { requires_approval: s.requires_approval, risk_level: s.risk_level }]),
      ),
      direct_response: plan.direct_response,
      tool_versions: Object.fromEntries(plan.steps.map((s) => [s.step_id, `${s.tool}:v1`])),
      planned_at: this.store.nowIso(),
    };
  }

  private rejectPlan(task: TaskRec, issues: { code: string; message: string; step_id: string | null }[]) {
    this.store.appendEvent(task, "PLAN_REJECTED", { payload: { issues: issues.slice(0, 20) } });
    const denied = issues.filter((i) => i.code === "permission_denied");
    task.failureCode = denied.length ? "policy_denied" : "plan_invalid";
    task.failureMessage = denied.length
      ? `The request needs actions that are not permitted: ${denied.map((i) => i.message).join("; ")}`.slice(0, 1600)
      : `A valid plan could not be produced: ${issues
          .slice(0, 5)
          .map((i) => i.message)
          .join("; ")}`.slice(0, 1600);
    this.transition(task, denied.length ? "blocked" : "failed", task.failureCode);
    task.resultSummary = buildSummary(this.store, task) as unknown as Record<string, unknown>;
  }

  // ------------------------------------------------------------------ execution loop
  private drive(task: TaskRec) {
    const r = this.rt(task);
    if (r.driving) {
      r.rerun = true;
      return;
    }
    r.driving = true;
    const finish = () => {
      r.driving = false;
      if (r.rerun) {
        r.rerun = false;
        this.enqueueExecute(task, 0);
      }
    };
    const iterate = (n: number) => {
      if (n > 200) return finish();
      const it = this.prepareIteration(task);
      if (it.stop) return finish();
      if (it.verify.length)
        return join(
          it.verify.map((s) => (done: Done) => this.verifyStep(task, s, done)),
          () => iterate(n + 1),
        );
      if (it.ready.length)
        return join(
          it.ready.map((s) => (done: Done) => this.runStep(task, s, done)),
          () => iterate(n + 1),
        );
      this.settle(task, finish);
    };
    iterate(0);
  }

  private dependencies(step: StepRec): Set<string> {
    const deps = new Set(step.dependencies);
    collectRefs(step.arguments, deps);
    return deps;
  }

  private prepareIteration(task: TaskRec): { stop: boolean; verify: StepRec[]; ready: StepRec[] } {
    const stop = { stop: true, verify: [], ready: [] };
    if (task.status === "completed" || task.status === "cancelled") return stop;
    if (task.status === "cancel_requested" || task.cancelRequested) {
      this.finalizeCancel(task);
      return stop;
    }
    if (task.pauseRequested && (task.status === "queued" || task.status === "running")) {
      task.pauseRequested = false;
      this.transition(task, "paused", "pause requested");
      return stop;
    }
    if (!["queued", "running", "recovering", "verifying"].includes(task.status)) return stop;
    if (task.status !== "running") this.transition(task, "running", "execution started");
    const steps = this.store.stepsOf(task);
    const byKey = new Map(steps.map((s) => [s.key, s]));
    const verify = steps.filter((s) => s.status === "verifying");
    let changed = true;
    while (changed) {
      changed = false;
      for (const st of steps) {
        if (st.status !== "pending") continue;
        const blocked = [...this.dependencies(st)].some((d) =>
          ["failed", "skipped", "cancelled"].includes(byKey.get(d)?.status ?? ""),
        );
        if (blocked) {
          this.stepTo(st, "skipped");
          st.errorMessage = SKIP_MESSAGE;
          this.store.appendEvent(task, "STEP_SKIPPED", { stepId: st.id, payload: { step: st.key } });
          changed = true;
        }
      }
    }
    let ready: StepRec[] = [];
    if (!verify.length) {
      const runnable = steps.filter(
        (st) =>
          (st.status === "pending" ||
            (st.status === "retry_scheduled" && (st.nextAttemptAt === null || st.nextAttemptAt <= this.now))) &&
          [...this.dependencies(st)].every((d) => byKey.get(d)?.status === "completed"),
      );
      ready = this.batch(runnable);
    }
    return { stop: false, verify, ready };
  }

  /** Independent read-only steps run concurrently; side-effecting steps run one at a time. */
  private batch(ready: StepRec[]): StepRec[] {
    const safe: StepRec[] = [];
    for (const st of ready) {
      const spec = TOOLS.get(st.tool);
      if (!spec) return [st];
      if (spec.parallel_safe && !hasSideEffects(spec.permission_level)) safe.push(st);
      else if (!safe.length) return [st];
    }
    return safe.slice(0, MAX_PARALLEL);
  }

  private outputs(task: TaskRec): Map<string, Record<string, unknown>> {
    const out = new Map<string, Record<string, unknown>>();
    for (const s of this.store.stepsOf(task)) if (s.status === "completed" && s.output) out.set(s.key, s.output);
    return out;
  }

  private runStep(task: TaskRec, step: StepRec, done: Done) {
    const started = this.beginStep(task, step);
    if (!started) return done();
    const sim = toolSim(step.tool);
    const t0 = this.now;
    this.store.sched.after(latency(...(sim?.latency ?? [600, 1400])), () => {
      let result: ToolResult | null = null;
      let failure: ToolFailure | null = null;
      try {
        if (!sim)
          throw new ToolFailure(
            "tool_unavailable",
            "tool_not_found",
            `The tool '${step.tool}' is not available in the demo.`,
          );
        result = sim.execute({ store: this.store, task, step, timeZone: this.timeZone() }, started);
      } catch (err) {
        failure = err instanceof ToolFailure ? err : new ToolFailure("unknown", "unexpected_error", "Unexpected error");
      }
      const elapsed = this.now - t0;
      if (failure || !result) {
        this.recordFailure(task, step, failure!);
        return done();
      }
      this.recordSuccess(task, step, result, elapsed);
      this.verifyStep(task, step, done);
    });
  }

  private beginStep(task: TaskRec, step: StepRec): Record<string, unknown> | null {
    if (step.status !== "pending" && step.status !== "retry_scheduled") return null;
    if (task.cancelRequested || task.status !== "running") return null;
    const spec = TOOLS.get(step.tool);
    if (!spec) {
      this.failStepNow(task, step, "tool_unavailable", "tool_not_found", `Tool '${step.tool}' not found`);
      return null;
    }
    let args: Record<string, unknown>;
    try {
      args = resolveRefs(step.arguments, this.outputs(task)) as Record<string, unknown>;
    } catch (err) {
      this.applyFailure(
        task,
        step,
        err instanceof ToolFailure ? err : new ToolFailure("invalid_input", "tool_input_invalid", "Invalid arguments"),
      );
      return null;
    }
    step.resolvedArgs = args;
    step.actionHash = hash64(JSON.stringify({ tool: `${spec.name}:${spec.version}`, args }));
    const decision = evaluatePermission(this.store, spec, {
      assessment: assess(spec, args, this.store.policy.policy),
      toolPolicy: this.toolPolicy(task),
      modelAsked: step.modelRequiresApproval,
    });
    step.permissionLevel = decision.level;
    step.riskLevel = decision.risk;
    step.policyReasons = decision.reasons;
    if (decision.decision === "deny") {
      this.store.audit({
        category: "tool",
        action: "tool.denied",
        status: "denied",
        actor_type: "worker",
        task_id: task.id,
        step_id: step.id,
        tool_name: spec.name,
        metadata: { reasons: decision.reasons },
      });
      this.applyFailure(
        task,
        step,
        new ToolFailure("policy_blocked", "policy_denied", `Blocked by policy: ${decision.reasons.join("; ")}`),
      );
      return null;
    }
    if (decision.decision === "require_approval") {
      step.requiresApproval = true;
      const valid = [...this.store.approvals.values()].find(
        (a) => a.step_id === step.id && a.actionHash === step.actionHash && a.status === "approved" && !a.consumed_at,
      );
      if (!valid) {
        this.requestApproval(task, step, args, decision.risk, decision.level, decision.reasons);
        this.stepTo(step, "waiting_approval");
        this.store.log(task, step, "info", `Waiting for your approval: ${describeAction(spec, args)}`);
        return null;
      }
      valid.consumed_at = this.store.nowIso(); // single use: an approval can never be replayed
    }
    const attempt = step.attemptCount + 1;
    step.attemptCount = attempt;
    step.nextAttemptAt = null;
    this.stepTo(step, "running");
    task.toolCalls += 1;
    this.store.appendEvent(task, "TOOL_CALL_STARTED", {
      stepId: step.id,
      payload: { step: step.key, tool: spec.name, attempt, action: describeAction(spec, args).slice(0, 300) },
    });
    this.store.log(task, step, "info", `Running: ${describeAction(spec, args).slice(0, 300)}`);
    return args;
  }

  private recordSuccess(task: TaskRec, step: StepRec, result: ToolResult, elapsedMs: number) {
    const spec = TOOLS.get(step.tool)!;
    step.output = result.output;
    step.outputTrust =
      result.untrusted || spec.output_trust === "untrusted_external_content"
        ? "untrusted_external_content"
        : "controlled_agent_output";
    step.outputSummary = result.summary.slice(0, 500);
    step.externalRef = result.externalRef ?? null;
    this.store.addUsage("tool_call");
    if (hasSideEffects(step.permissionLevel)) {
      this.store.audit({
        category: "tool",
        action: "tool.executed",
        actor_type: "worker",
        user_id: task.userId,
        task_id: task.id,
        step_id: step.id,
        tool_name: spec.name,
        approval_id: step.approvalRequestId,
        resource_type: "external_ref",
        resource_id: step.externalRef,
        result_summary: result.summary,
      });
    }
    this.store.appendEvent(task, "TOOL_CALL_FINISHED", {
      stepId: step.id,
      payload: { step: step.key, tool: spec.name, summary: step.outputSummary, duration_ms: elapsedMs },
    });
    this.stepTo(step, "verifying");
  }

  private recordFailure(task: TaskRec, step: StepRec, failure: ToolFailure) {
    this.store.addUsage("tool_call");
    this.store.appendEvent(task, "TOOL_CALL_FINISHED", {
      stepId: step.id,
      payload: { step: step.key, tool: step.tool, error: failure.code, error_class: failure.errorClass },
    });
    this.applyFailure(task, step, failure);
  }

  private applyFailure(task: TaskRec, step: StepRec, failure: ToolFailure) {
    const spec = TOOLS.get(step.tool)!;
    const decision = decideRecovery(failure, spec, step.attemptCount || 1);
    step.errorClass = failure.errorClass;
    step.errorCode = failure.code;
    step.errorMessage = failure.message.slice(0, 2000);
    this.recordFailurePattern(task, step, failure, decision.action);
    this.store.appendEvent(task, "RECOVERY_DECIDED", {
      stepId: step.id,
      payload: { step: step.key, decision: decision.action, reason: decision.reason, error_class: failure.errorClass },
    });
    if (step.status === "pending" || step.status === "retry_scheduled") this.stepTo(step, "running");
    switch (decision.action) {
      case "retry":
        this.stepTo(step, "retry_scheduled");
        step.nextAttemptAt = this.now + decision.delaySeconds * 1000;
        this.store.appendEvent(task, "RETRY_SCHEDULED", {
          stepId: step.id,
          payload: { step: step.key, delay_seconds: decision.delaySeconds },
        });
        this.store.log(task, step, "warning", `Temporary problem (${failure.errorClass}); will retry.`);
        break;
      case "request_user": {
        this.stepTo(step, "waiting_input");
        const question = decision.question ?? failure.message;
        task.pendingQuestions = [question];
        task.pendingInput = { stepId: step.id, stepKey: step.key, question, details: failure.details };
        this.store.log(task, step, "info", `Needs your input: ${question}`);
        break;
      }
      case "block":
        this.stepTo(step, "blocked");
        this.store.log(task, step, "warning", `Blocked: ${decision.reason}.`);
        break;
      default:
        this.stepTo(step, "failed");
        this.store.appendEvent(task, "STEP_FAILED", {
          stepId: step.id,
          payload: { step: step.key, error: failure.code, message: failure.message.slice(0, 500) },
        });
        this.store.log(task, step, "error", `Failed: ${failure.message.slice(0, 300)}`);
    }
  }

  private failStepNow(task: TaskRec, step: StepRec, cls: string, code: string, message: string) {
    if (step.status === "pending" || step.status === "retry_scheduled") this.stepTo(step, "running");
    this.stepTo(step, "failed");
    step.errorClass = cls;
    step.errorCode = code;
    step.errorMessage = message;
    this.store.appendEvent(task, "STEP_FAILED", { stepId: step.id, payload: { step: step.key, error: code } });
  }

  /** Feed ACBE: failures are fingerprinted per (tool, error class, code). */
  private recordFailurePattern(task: TaskRec, step: StepRec, failure: ToolFailure, decision: string) {
    if (failure.errorClass === "needs_user_input") return;
    const fingerprint = hash64(`${step.tool}|${failure.errorClass}|${failure.code}`).slice(0, 64);
    const now = this.store.nowIso();
    let p = this.store.failurePatterns.find((f) => f.fingerprint === fingerprint);
    if (!p) {
      p = {
        fingerprint,
        tool_name: step.tool,
        error_class: failure.errorClass,
        error_code: failure.code,
        failure_type: failure.errorClass === "transient" ? "transient_provider_error" : failure.errorClass,
        sample_message: failure.message.slice(0, 300),
        occurrences: 0,
        tasks: 0,
        first_seen: now,
        last_seen: now,
        learnable: ["transient", "timeout", "rate_limited", "verification_failed"].includes(failure.errorClass),
        significant: false,
        strategy_versions: {},
      };
      this.store.failurePatterns.push(p);
    }
    p.occurrences += 1;
    p.last_seen = now;
    if (step.attemptCount <= 1 && decision !== "request_user") p.tasks += 1;
    p.strategy_versions.baseline = (p.strategy_versions.baseline ?? 0) + 1;
    p.significant = p.occurrences >= 5;
  }

  private addVerification(
    task: TaskRec,
    step: StepRec | null,
    method: string,
    expected: Record<string, unknown>,
    observed: Record<string, unknown>,
    evidence: Record<string, unknown>,
  ) {
    this.store.verifications.push({
      id: uuid(),
      taskId: task.id,
      step_id: step?.id ?? null,
      scope: step ? "step" : "task",
      status: "passed",
      method,
      expected,
      observed,
      differences: [],
      evidence,
      verified_at: this.store.nowIso(),
    });
  }

  private verifyStep(task: TaskRec, step: StepRec, done: Done) {
    if (step.status !== "verifying") return done();
    const spec = TOOLS.get(step.tool)!;
    const method = spec.verification_method;
    this.store.appendEvent(task, "VERIFICATION_STARTED", { stepId: step.id, payload: { step: step.key, method } });
    this.store.sched.after(latency(350, 900), () => {
      if (step.status !== "verifying") return done();
      const out = step.output ?? {};
      const args = step.resolvedArgs ?? {};
      const pick = (o: Record<string, unknown>, keys: string[]) =>
        Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
      if (method === "read_back") {
        const keys = Object.keys(args).filter((k) => k in out);
        this.addVerification(task, step, method, pick(args, keys), pick(out, keys), {
          external_ref: step.externalRef,
          read_at: this.store.nowIso(),
        });
      } else if (method === "provider_confirmation") {
        this.addVerification(
          task,
          step,
          method,
          pick(args, ["to", "subject"]),
          pick(out, ["to", "subject", "label_ids"]),
          { message_id: step.externalRef },
        );
      } else {
        this.addVerification(
          task,
          step,
          method,
          { schema: `${spec.name}:${spec.version} output` },
          { valid: true },
          { fields: Object.keys(out) },
        );
      }
      step.verificationStatus = "passed";
      step.verificationMethod = method;
      this.stepTo(step, "completed");
      step.errorClass = step.errorCode = step.errorMessage = null;
      this.store.appendEvent(task, "VERIFICATION_PASSED", { stepId: step.id, payload: { step: step.key, method } });
      this.store.appendEvent(task, "STEP_COMPLETED", {
        stepId: step.id,
        payload: { step: step.key, summary: step.outputSummary },
      });
      this.store.log(task, step, "info", `Verified (${method}): ${step.outputSummary}`);
      this.updateProgress(task);
      done();
    });
  }

  private updateProgress(task: TaskRec) {
    const steps = this.store.stepsOf(task);
    const doneCount = steps.filter((s) => s.status === "completed").length;
    task.progress = steps.length ? Math.round((doneCount / steps.length) * 1000) / 1000 : 0;
  }

  private settle(task: TaskRec, finish: Done) {
    if (task.status !== "running") return finish();
    const steps = this.store.stepsOf(task);
    const statuses = new Set(steps.map((s) => s.status));
    if (steps.every((s) => STEP_TERMINAL.has(s.status))) {
      if (steps.some((s) => s.status === "failed" || s.status === "skipped" || s.status === "cancelled")) {
        const first = steps.find((s) => s.status === "failed") ?? steps[0];
        this.failTask(task, first.errorCode || "step_failed", first.errorMessage || "A step did not complete.");
        return finish();
      }
      return this.completeTask(task, steps, finish);
    }
    if (statuses.has("waiting_approval")) {
      this.transition(task, "waiting_approval", "waiting for approval");
    } else if (statuses.has("waiting_input")) {
      this.transition(task, "waiting_input", "waiting for user input", {
        payload: { questions: task.pendingQuestions ?? [] },
      });
      this.store.appendEvent(task, "INPUT_REQUIRED", { payload: { questions: task.pendingQuestions ?? [] } });
      this.notify(
        task,
        "input_required",
        "Your task needs input",
        (task.pendingQuestions ?? []).join("; "),
        `input:${task.id}:${task.events.length}`,
      );
    } else if (statuses.has("blocked")) {
      this.transition(task, "blocked", "blocked; user action required");
      const blocked = steps.find((s) => s.status === "blocked")!;
      task.failureCode = blocked.errorCode;
      task.failureMessage = blocked.errorMessage;
      this.notify(
        task,
        "task_failed",
        "Your task is blocked",
        blocked.errorMessage || "Action required",
        `blocked:${task.id}:${blocked.id}`,
      );
    } else if (statuses.has("retry_scheduled")) {
      const next = Math.min(
        ...steps.filter((s) => s.status === "retry_scheduled").map((s) => s.nextAttemptAt ?? this.now),
      );
      this.transition(task, "queued", "retry scheduled");
      this.enqueueExecute(task, Math.max(0, next - this.now));
    } else {
      this.transition(task, "queued", "re-evaluating");
      this.enqueueExecute(task, 2000);
    }
    finish();
  }

  private completeTask(task: TaskRec, steps: StepRec[], finish: Done) {
    this.transition(task, "verifying", "final verification");
    this.store.sched.after(latency(450, 900), () => {
      if (task.status !== "verifying") return finish();
      const unverified = steps.filter((s) => s.verificationStatus !== "passed").map((s) => s.key);
      if (unverified.length) {
        this.store.verifications.push({
          id: uuid(),
          taskId: task.id,
          step_id: null,
          scope: "task",
          status: "failed",
          method: "state_comparison",
          expected: {},
          observed: {},
          differences: [{ field: "steps", expected: "all verified", observed: unverified }],
          evidence: {},
          verified_at: this.store.nowIso(),
        });
        this.transition(task, "requires_reconciliation", "final verification found unverified work");
        return finish();
      }
      const refs = steps
        .filter((s) => s.permissionLevel !== "read")
        .map((s) => ({ step: s.key, tool: s.tool, external_ref: s.externalRef }));
      this.addVerification(
        task,
        null,
        "state_comparison",
        { steps: steps.length },
        { verified_steps: steps.length },
        { side_effects: refs },
      );
      task.progress = 1;
      task.pendingQuestions = null;
      task.failureCode = task.failureMessage = null;
      this.transition(task, "completed", "all steps verified");
      const summary = buildSummary(this.store, task);
      task.resultSummary = summary as unknown as Record<string, unknown>;
      this.syncAutomation(task);
      this.store.audit({
        category: "task",
        action: "task.completed",
        actor_type: "worker",
        user_id: task.userId,
        task_id: task.id,
        result_summary: summary.headline,
      });
      this.notify(task, "task_completed", "Task completed", summary.headline, `completed:${task.id}`);
      finish();
    });
  }

  private failTask(task: TaskRec, code: string, message: string) {
    task.failureCode = code.slice(0, 80);
    task.failureMessage = message.slice(0, 2000);
    this.forceStatus(task, "failed", code);
    task.resultSummary = buildSummary(this.store, task) as unknown as Record<string, unknown>;
    this.syncAutomation(task);
    this.store.audit({
      category: "task",
      action: "task.failed",
      status: "failure",
      actor_type: "worker",
      user_id: task.userId,
      task_id: task.id,
      result_summary: message.slice(0, 500),
    });
    this.notify(task, "task_failed", "Task failed", message.slice(0, 1000), `failed:${task.id}:${task.events.length}`, {
      code,
    });
  }

  private finalizeCancel(task: TaskRec) {
    const steps = this.store.stepsOf(task);
    for (const st of steps) {
      if (["pending", "waiting_approval", "waiting_input", "retry_scheduled", "blocked"].includes(st.status))
        this.stepTo(st, "cancelled");
    }
    this.cancelApprovals(task);
    if (task.status !== "cancel_requested") this.forceStatus(task, "cancel_requested", "cancel requested");
    const unresolved = steps.some((s) => s.status === "requires_reconciliation" || s.status === "waiting_external");
    if (unresolved) this.transition(task, "requires_reconciliation", "cancelled with an action of unknown outcome");
    else this.transition(task, "cancelled", "cancelled by user");
    task.resultSummary = buildSummary(this.store, task) as unknown as Record<string, unknown>;
    this.store.audit({
      category: "task",
      action: "task.cancelled",
      actor_type: "worker",
      user_id: task.userId,
      task_id: task.id,
    });
  }

  private syncAutomation(task: TaskRec) {
    if (!task.automationRunId) return;
    const run = this.store.automationRuns.find((r) => r.id === task.automationRunId);
    if (!run) return;
    const outcome = task.status === "completed" ? "succeeded" : "failed";
    run.status = outcome;
    run.finished_at = this.store.nowIso();
    run.error = outcome === "failed" ? task.failureMessage : null;
    const automation = this.store.automations.find((a) => a.id === run.automation_id);
    if (automation) {
      automation.last_status = outcome;
      automation.consecutive_failures = outcome === "failed" ? automation.consecutive_failures + 1 : 0;
      automation.updated_at = this.store.nowIso();
    }
  }
}
