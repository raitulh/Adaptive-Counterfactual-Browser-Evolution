/**
 * Event → timeline normalization (pure, framework-free).
 *
 * The backend records every task event durably (`task_events`, gap-free `seq`). This module turns
 * that raw, ordered stream into human timeline entries:
 *
 *  - related events are merged into one entry (TOOL_CALL_STARTED + TOOL_CALL_FINISHED = one tool
 *    call with a duration; VERIFICATION_STARTED + PASSED/FAILED (+ the STEP_COMPLETED it produces)
 *    = one verification; RECOVERY_DECIDED(retry) + RETRY_SCHEDULED = one retry decision);
 *  - requests that were later answered stop "waiting" (an APPROVAL_REQUIRED followed by
 *    APPROVAL_GRANTED is shown as resolved);
 *  - bookkeeping status changes already implied by a semantic event are hidden unless `showAll`;
 *  - every entry carries the raw events it was built from (for the developer "advanced" view).
 *
 * Nothing here infers success: an entry is only "done" when the backend recorded it.
 */
import type { RiskLevel, TaskEvent, TaskStatus } from "@/lib/api";
import { humanize, humanizeTool } from "@/lib/format";
import { isTaskActive, type Tone } from "@/lib/status";

export type TimelinePhase = "planning" | "execution" | "verification" | "recovery" | "approval" | "outcome";

export type TimelineEntryKind =
  | "task"
  | "plan"
  | "tool_call"
  | "verification"
  | "step"
  | "approval"
  | "input"
  | "recovery"
  | "control"
  | "budget"
  | "generic";

/**
 * active  – in progress right now (backend has not recorded an end yet)
 * waiting – blocked on a person (approval, input, confirmation)
 * done    – recorded as finished
 * failed  – recorded as failed / rejected
 * skipped – intentionally not run
 * info    – a fact with no progress semantics
 */
export type TimelineEntryState = "active" | "waiting" | "done" | "failed" | "skipped" | "info";

/** The subset of `StepOut` the timeline needs (mock data for demos can provide just this). */
export interface TimelineStep {
  id: string;
  step_key: string;
  action: string;
  tool_name: string;
  tool_version?: string;
  plan_version?: number;
}

export interface TimelineEntry {
  /** Stable React key. */
  key: string;
  /** Sequence of the first event in this entry (entries are ordered by it). */
  seq: number;
  kind: TimelineEntryKind;
  phase: TimelinePhase;
  tone: Tone;
  state: TimelineEntryState;
  /** Human sentence. */
  title: string;
  /** Secondary human line (result, reason, summary). */
  detail?: string | null;
  /** Short list (questions, validation issues, differences). */
  bullets?: string[];
  /** Raw tool name (render mono) and its humanized label. */
  tool?: string | null;
  toolLabel?: string | null;
  durationMs?: number | null;
  attempt?: number | null;
  stepId?: string | null;
  stepKey?: string | null;
  /** The planner's description of the step ("Find a free 30-minute slot…"). */
  stepLabel?: string | null;
  /** Verification method (raw) and label. */
  method?: string | null;
  methodLabel?: string | null;
  riskLevel?: RiskLevel | null;
  approvalId?: string | null;
  /** Actor of the event that last changed this entry ("user", "system", "worker"…). */
  actor?: string | null;
  /** created_at of the first / last event. */
  at: string;
  endedAt?: string | null;
  /** Hidden bookkeeping entry (only produced with `showAll`). */
  minor?: boolean;
  /** Raw events merged into this entry, in order. */
  events: TaskEvent[];
}

export interface TimelinePhaseGroup {
  key: string;
  phase: TimelinePhase;
  label: string;
  state: "active" | "waiting" | "failed" | "done";
  entries: TimelineEntry[];
}

export interface NormalizeOptions {
  /** Steps of the task (any plan version) — used to name steps ("Look up Rahim's e-mail address"). */
  steps?: readonly TimelineStep[];
  /** Include bookkeeping events that are implied by others (developer view). */
  showAll?: boolean;
  /**
   * Current task status. When the task is no longer being driven by a worker, nothing can still be
   * "in progress": leftover active entries are downgraded to `info` (no pulsing).
   */
  taskStatus?: TaskStatus;
}

// --------------------------------------------------------------------------------------------- helpers

type Payload = Record<string, unknown>;

function str(p: Payload, key: string): string | null {
  const v = p[key];
  return typeof v === "string" && v.trim() ? v : null;
}

function num(p: Payload, key: string): number | null {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function strList(p: Payload, key: string): string[] {
  const v = p[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

function sentence(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = value.trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function seconds(value: number): string {
  return value < 10 ? `${value.toFixed(1)}s` : `${Math.round(value)}s`;
}

const RISK_LEVELS = new Set<RiskLevel>(["low", "medium", "high", "critical"]);

/** Verification method → human label. */
export function verificationMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  switch (method) {
    case "read_back":
      return "Read back from the provider";
    case "output_schema":
      return "Output checked against the expected schema";
    case "provider_confirmation":
      return "Confirmed by the provider";
    case "user_input":
      return "Provided by you";
    case "user_confirmation":
      return "Confirmed by you";
    case "none":
      return "No verification";
    default:
      return humanize(method);
  }
}

const ERROR_CLASS_LABELS: Record<string, string> = {
  transient: "Temporary problem at the provider",
  timeout: "The call timed out",
  rate_limited: "Rate limited by the provider",
  network_error: "Network error",
  auth_expired: "The connection needs to be reconnected",
  permission_denied: "Permission denied",
  invalid_input: "The request was invalid",
  tool_unavailable: "The tool is unavailable",
  conflict: "Conflict with the current state",
  verification_failed: "The result could not be verified",
  model_error: "The model failed",
  policy_blocked: "Blocked by policy",
  needs_user_input: "Needs information from you",
  unknown_outcome: "Outcome unknown",
  unknown: "Unexpected error",
};

/** error_class / error code → human text. */
export function errorLabel(errorClass: string | null | undefined, code?: string | null): string {
  if (code === "integration_not_connected") return "Google is not connected";
  if (code === "integration_temporarily_unavailable") return "The provider is temporarily unavailable";
  if (code === "approval_rejected") return "You rejected this action";
  if (code === "retries_exhausted") return "Retries exhausted";
  if (errorClass && ERROR_CLASS_LABELS[errorClass]) return ERROR_CLASS_LABELS[errorClass];
  if (code) return humanize(code);
  return errorClass ? humanize(errorClass) : "Failed";
}

// Status changes whose meaning is already carried by a semantic event (hidden unless showAll).
const IMPLIED_TARGETS = new Set(["created", "planning", "planned", "validating", "queued", "waiting_approval", "waiting_input"]);

function phaseForUnknown(type: string): TimelinePhase {
  if (type.includes("PLAN")) return "planning";
  if (type.includes("VERIF")) return "verification";
  if (type.includes("APPROVAL") || type.includes("INPUT")) return "approval";
  if (type.includes("RECOVER") || type.includes("RETRY") || type.includes("RECONCIL") || type.includes("FAIL")) return "recovery";
  if (type.startsWith("TASK_")) return "outcome";
  return "execution";
}

// --------------------------------------------------------------------------------------------- normalize

export function normalizeTimeline(events: readonly TaskEvent[], options: NormalizeOptions = {}): TimelineEntry[] {
  const { steps = [], showAll = false, taskStatus } = options;
  const byId = new Map<string, TimelineStep>();
  const byKey = new Map<string, TimelineStep>();
  for (const s of steps) {
    byId.set(s.id, s);
    const prev = byKey.get(s.step_key);
    if (!prev || (s.plan_version ?? 0) >= (prev.plan_version ?? 0)) byKey.set(s.step_key, s);
  }

  const entries: TimelineEntry[] = [];
  const openTool = new Map<string, TimelineEntry>();
  const openVerify = new Map<string, TimelineEntry>();
  const verifiedAwaitingCompletion = new Map<string, TimelineEntry>();
  const retryDecision = new Map<string, TimelineEntry>();
  const openReconcile = new Map<string, TimelineEntry>();
  const approvals = new Map<string, TimelineEntry>();
  const planStepCounts = new Map<number, number>();
  let lastPlanSteps: number | null = null;
  let openInput: TimelineEntry | null = null;
  let openPlanning: TimelineEntry | null = null;
  let openFinalVerify: TimelineEntry | null = null;
  let openCancel: TimelineEntry | null = null;
  let openBlocked: TimelineEntry | null = null;
  let seenRunning = false;

  const stepOf = (e: TaskEvent, p: Payload): TimelineStep | null =>
    (e.step_id ? byId.get(e.step_id) : undefined) ?? (str(p, "step") ? byKey.get(str(p, "step")!) : undefined) ?? null;
  const stepRef = (e: TaskEvent, p: Payload) => e.step_id ?? `key:${str(p, "step") ?? "?"}`;
  const labelOf = (e: TaskEvent, p: Payload) => {
    const s = stepOf(e, p);
    return s?.action ?? (str(p, "step") ? humanize(str(p, "step")) : null);
  };

  const make = (e: TaskEvent, init: Omit<TimelineEntry, "key" | "seq" | "at" | "events"> & { key?: string }): TimelineEntry => {
    const p = e.payload as Payload;
    const step = stepOf(e, p);
    const { key, ...rest } = init;
    const entry: TimelineEntry = {
      key: key ?? `e${e.seq}`,
      seq: e.seq,
      at: e.created_at,
      events: [e],
      actor: e.actor_type,
      stepId: e.step_id ?? step?.id ?? null,
      stepKey: str(p, "step") ?? step?.step_key ?? null,
      stepLabel: labelOf(e, p),
      ...rest,
    };
    entries.push(entry);
    return entry;
  };
  const attach = (entry: TimelineEntry, e: TaskEvent) => {
    entry.events.push(e);
    entry.endedAt = e.created_at;
    entry.actor = e.actor_type;
  };
  const resolvePlanning = () => {
    if (openPlanning && openPlanning.state === "active") openPlanning.state = "done";
    openPlanning = null;
  };
  const resolveLifecycle = () => {
    if (openFinalVerify?.state === "active") openFinalVerify.state = "done";
    openFinalVerify = null;
    if (openBlocked?.state === "waiting") openBlocked.state = "done";
    openBlocked = null;
  };

  for (const e of events) {
    const p = (e.payload ?? {}) as Payload;
    const type = e.event_type;
    switch (type) {
      case "TASK_CREATED": {
        const source = str(p, "source");
        make(e, {
          kind: "task",
          phase: "planning",
          tone: "neutral",
          state: "done",
          title: "Goal received",
          detail: source && source !== "api" ? `Started by ${humanize(source).toLowerCase()}` : null,
        });
        break;
      }
      case "PLANNING_STARTED": {
        resolvePlanning();
        const replan = p.replan === true;
        openPlanning = make(e, {
          kind: "plan",
          phase: "planning",
          tone: "accent",
          state: "active",
          title: replan ? "Re-planning with the new information" : "Understanding the goal and drafting a plan",
        });
        break;
      }
      case "PLAN_CREATED": {
        resolvePlanning();
        const n = num(p, "steps") ?? 0;
        const version = num(p, "plan_version");
        if (version !== null) planStepCounts.set(version, n);
        lastPlanSteps = n;
        make(e, {
          kind: "plan",
          phase: "planning",
          tone: "accent",
          state: "done",
          title: n > 0 ? `Plan created · ${plural(n, "step")}` : "Plan created · no actions needed",
          detail: sentence(str(p, "summary")),
        });
        break;
      }
      case "PLAN_VALIDATED": {
        const version = num(p, "plan_version");
        const n = version !== null ? planStepCounts.get(version) : undefined;
        const approvalsExpected = num(p, "approvals_expected") ?? 0;
        make(e, {
          kind: "plan",
          phase: "planning",
          tone: "accent",
          state: "done",
          title: n ? `Plan validated · ${plural(n, "step")}` : "Plan validated",
          detail:
            approvalsExpected > 0
              ? `${plural(approvalsExpected, "action")} will need your approval before running`
              : n
                ? "Checked against tools, permissions and policy — no approvals needed"
                : null,
        });
        break;
      }
      case "PLAN_REJECTED": {
        resolvePlanning();
        const issues = Array.isArray(p.issues) ? (p.issues as Payload[]) : [];
        make(e, {
          kind: "plan",
          phase: "planning",
          tone: "danger",
          state: "failed",
          title: "Plan rejected by safety checks",
          bullets: issues.map((i) => str(i, "message")).filter((m): m is string => Boolean(m)).slice(0, 8),
        });
        break;
      }
      case "TASK_STATE_CHANGED": {
        const to = str(p, "to") ?? "";
        const from = str(p, "from");
        const reason = sentence(str(p, "reason"));
        if (to !== "planning" && to !== "waiting_input") resolvePlanning();
        if (to !== "verifying") {
          if (openFinalVerify?.state === "active") openFinalVerify.state = "done";
          openFinalVerify = null;
        }
        if (to !== "blocked" && openBlocked?.state === "waiting") {
          openBlocked.state = "done";
          openBlocked = null;
        }
        if (to === "running") {
          if (!seenRunning) {
            seenRunning = true;
            make(e, { kind: "task", phase: "execution", tone: "accent", state: "info", title: "Execution started" });
          } else if (showAll) {
            make(e, { kind: "task", phase: "execution", tone: "neutral", state: "info", title: "Execution continued", detail: reason, minor: true });
          }
        } else if (to === "verifying") {
          openFinalVerify = make(e, {
            kind: "task",
            phase: "verification",
            tone: "verify",
            state: "active",
            title: "Final verification of every result",
          });
        } else if (to === "recovering") {
          make(e, { kind: "recovery", phase: "recovery", tone: "recover", state: "info", title: "Recovering", detail: reason });
        } else if (to === "requires_reconciliation") {
          make(e, {
            kind: "recovery",
            phase: "recovery",
            tone: "recover",
            state: "waiting",
            title: "Waiting for you to confirm an action's outcome",
            detail: "AgentOS will not repeat an action it could not verify without your confirmation.",
          });
        } else if (to === "blocked") {
          openBlocked = make(e, {
            kind: "task",
            phase: "recovery",
            tone: "danger",
            state: "waiting",
            title: "Blocked until you take action",
            detail: reason && reason !== "Blocked; user action required" ? reason : null,
          });
        } else if (to === "expired") {
          make(e, { kind: "task", phase: "outcome", tone: "neutral", state: "failed", title: "Expired while waiting", detail: reason });
        } else if (IMPLIED_TARGETS.has(to)) {
          if (showAll)
            make(e, {
              kind: "task",
              phase: to === "waiting_approval" || to === "waiting_input" ? "approval" : to === "queued" ? "execution" : "planning",
              tone: "neutral",
              state: "info",
              title: `Status: ${humanize(from ?? "?")} → ${humanize(to)}`,
              detail: reason,
              minor: true,
            });
        } else {
          make(e, { kind: "task", phase: phaseForUnknown(to.toUpperCase()), tone: "neutral", state: "info", title: `Status changed to ${humanize(to).toLowerCase()}`, detail: reason });
        }
        break;
      }
      case "STEP_STARTED": {
        make(e, { kind: "step", phase: "execution", tone: "accent", state: "info", title: `Started: ${labelOf(e, p) ?? "a step"}` });
        break;
      }
      case "TOOL_CALL_STARTED": {
        const tool = str(p, "tool");
        const entry = make(e, {
          key: `tool-${e.seq}`,
          kind: "tool_call",
          phase: "execution",
          tone: "accent",
          state: "active",
          title: tool ? humanizeTool(tool) : "Tool call",
          tool,
          toolLabel: tool ? humanizeTool(tool) : null,
          attempt: num(p, "attempt"),
          detail: null,
        });
        openTool.set(stepRef(e, p), entry);
        break;
      }
      case "TOOL_CALL_FINISHED": {
        const ref = stepRef(e, p);
        const tool = str(p, "tool");
        let entry = openTool.get(ref);
        if (entry) {
          attach(entry, e);
          openTool.delete(ref);
        } else {
          entry = make(e, {
            key: `tool-${e.seq}`,
            kind: "tool_call",
            phase: "execution",
            tone: "accent",
            state: "done",
            title: tool ? humanizeTool(tool) : "Tool call",
            tool,
            toolLabel: tool ? humanizeTool(tool) : null,
          });
        }
        const errorCode = str(p, "error");
        const errorClass = str(p, "error_class");
        const summary = str(p, "summary");
        entry.durationMs = num(p, "duration_ms") ?? entry.durationMs ?? null;
        if (errorClass === "needs_user_input" || errorCode === "needs_user_input") {
          // Not a failure: the tool needs information only the user has.
          entry.state = "info";
          entry.tone = "warning";
          entry.detail = "Needs information from you";
        } else if (errorCode || (errorClass && !summary)) {
          entry.state = "failed";
          entry.tone = "danger";
          entry.detail = errorLabel(errorClass, errorCode);
        } else {
          entry.state = "done";
          entry.detail = sentence(summary);
        }
        break;
      }
      case "VERIFICATION_STARTED": {
        const method = str(p, "method");
        const label = labelOf(e, p);
        const entry = make(e, {
          key: `verify-${e.seq}`,
          kind: "verification",
          phase: "verification",
          tone: "verify",
          state: "active",
          title: label ? `Verifying: ${label}` : "Verifying the result",
          method,
          methodLabel: verificationMethodLabel(method),
        });
        openVerify.set(stepRef(e, p), entry);
        break;
      }
      case "VERIFICATION_PASSED":
      case "VERIFICATION_FAILED": {
        const ref = stepRef(e, p);
        const label = labelOf(e, p);
        const method = str(p, "method");
        let entry = openVerify.get(ref);
        if (entry) {
          attach(entry, e);
          openVerify.delete(ref);
        } else {
          entry = make(e, { key: `verify-${e.seq}`, kind: "verification", phase: "verification", tone: "verify", state: "done", title: "" });
        }
        if (method) {
          entry.method = method;
          entry.methodLabel = verificationMethodLabel(method);
        }
        if (type === "VERIFICATION_PASSED") {
          entry.state = "done";
          entry.tone = "verify";
          entry.title = label ? `Verified: ${label}` : "Result verified";
          verifiedAwaitingCompletion.set(ref, entry);
        } else {
          const inconclusive = str(p, "status") === "inconclusive";
          const differences = strList(p, "differences");
          entry.state = "failed";
          entry.tone = inconclusive ? "recover" : "danger";
          entry.title = inconclusive
            ? `Could not verify: ${label ?? "the result"}`
            : `Verification failed: ${label ?? "the result"}`;
          entry.detail = inconclusive
            ? "The external system did not confirm the result."
            : "The external system shows a different result than expected.";
          if (differences.length) entry.bullets = [`Differs in: ${differences.map(humanize).join(", ")}`];
        }
        break;
      }
      case "STEP_COMPLETED": {
        const ref = stepRef(e, p);
        const verified = verifiedAwaitingCompletion.get(ref);
        if (verified) {
          attach(verified, e);
          verifiedAwaitingCompletion.delete(ref);
          const summary = sentence(str(p, "summary"));
          if (summary && !verified.detail) verified.detail = summary;
        } else {
          const fromUser = str(p, "source") === "user";
          make(e, {
            kind: "step",
            phase: "execution",
            tone: fromUser ? "success" : "accent",
            state: "done",
            title: fromUser ? `Completed with your answer: ${labelOf(e, p) ?? "step"}` : `Completed: ${labelOf(e, p) ?? "step"}`,
            detail: sentence(str(p, "summary")),
          });
        }
        break;
      }
      case "STEP_FAILED": {
        const code = str(p, "error");
        make(e, {
          kind: "step",
          phase: "recovery",
          tone: "danger",
          state: "failed",
          title: `Step failed: ${labelOf(e, p) ?? "a step"}`,
          detail: sentence(str(p, "message")) ?? errorLabel(null, code),
        });
        break;
      }
      case "STEP_SKIPPED": {
        make(e, {
          kind: "step",
          phase: "execution",
          tone: "neutral",
          state: "skipped",
          title: `Skipped: ${labelOf(e, p) ?? "a step"}`,
          detail: "A step it depends on did not complete.",
        });
        break;
      }
      case "APPROVAL_REQUIRED": {
        const summary = str(p, "summary");
        const risk = str(p, "risk_level");
        const approvalId = str(p, "approval_id");
        const entry = make(e, {
          kind: "approval",
          phase: "approval",
          tone: "warning",
          state: "waiting",
          title: `Waiting for your approval: ${summary ?? labelOf(e, p) ?? "an action"}`,
          riskLevel: risk && RISK_LEVELS.has(risk as RiskLevel) ? (risk as RiskLevel) : null,
          approvalId,
        });
        if (approvalId) approvals.set(approvalId, entry);
        break;
      }
      case "APPROVAL_GRANTED":
      case "APPROVAL_REJECTED":
      case "APPROVAL_EXPIRED": {
        const approvalId = str(p, "approval_id");
        const request = approvalId ? approvals.get(approvalId) : undefined;
        const summary = request ? request.title.replace(/^Waiting for your approval: /, "") : labelOf(e, p);
        if (request && request.state === "waiting") {
          request.state = "done";
          request.tone = "neutral";
          request.title = `Approval requested: ${summary}`;
        }
        // The request row right above already restates the action.
        const adjacent = request !== undefined && entries[entries.length - 1] === request;
        if (type === "APPROVAL_GRANTED") {
          make(e, { kind: "approval", phase: "approval", tone: "success", state: "done", title: e.actor_type === "user" ? "Approved" : "Approval granted", detail: adjacent ? null : summary, approvalId });
        } else if (type === "APPROVAL_REJECTED") {
          const reason = str(p, "reason");
          make(e, { kind: "approval", phase: "approval", tone: "danger", state: "failed", title: "Rejected — the action will not run", detail: reason ? `Reason: ${reason}` : summary, approvalId });
        } else {
          make(e, { kind: "approval", phase: "approval", tone: "neutral", state: "failed", title: "Approval expired without a decision", detail: adjacent ? null : summary, approvalId });
        }
        break;
      }
      case "INPUT_REQUIRED": {
        resolvePlanning();
        const questions = strList(p, "questions");
        openInput = make(e, {
          kind: "input",
          phase: "approval",
          tone: "warning",
          state: "waiting",
          title: "AgentOS needs your input",
          bullets: questions,
        });
        break;
      }
      case "INPUT_RECEIVED": {
        if (openInput?.state === "waiting") {
          openInput.state = "done";
          openInput.tone = "neutral";
          openInput.title = "Asked for your input";
        }
        openInput = null;
        const question = str(p, "question");
        make(e, { kind: "input", phase: "approval", tone: "success", state: "done", title: "You answered", detail: question ? `In reply to: “${question}”` : null });
        break;
      }
      case "RETRY_SCHEDULED": {
        const ref = stepRef(e, p);
        const delay = num(p, "delay_seconds");
        const decision = retryDecision.get(ref);
        if (decision) {
          attach(decision, e);
          retryDecision.delete(ref);
          if (delay !== null) decision.detail = [decision.detail, `next attempt in ${seconds(delay)}`].filter(Boolean).join(" · ");
        } else {
          make(e, { kind: "recovery", phase: "recovery", tone: "recover", state: "info", title: `Retry scheduled: ${labelOf(e, p) ?? "step"}`, detail: delay !== null ? `Next attempt in ${seconds(delay)}` : null });
        }
        break;
      }
      case "RECOVERY_STARTED": {
        const reason = str(p, "reason");
        make(e, {
          kind: "recovery",
          phase: "recovery",
          tone: "recover",
          state: "info",
          title: "Resuming safely after an interruption",
          detail:
            reason === "worker_or_job_lost"
              ? "The worker running this task stopped unexpectedly; AgentOS picked it up again."
              : sentence(reason ? humanize(reason) : null),
        });
        break;
      }
      case "RECOVERY_DECIDED": {
        const decision = str(p, "decision");
        const reason = sentence(str(p, "reason"));
        const errorClass = str(p, "error_class");
        const label = labelOf(e, p) ?? "a step";
        const base = { kind: "recovery" as const, phase: "recovery" as const };
        if (decision === "retry") {
          const entry = make(e, { ...base, tone: "recover", state: "info", title: `Retrying: ${label}`, detail: errorLabel(errorClass) });
          retryDecision.set(stepRef(e, p), entry);
        } else if (decision === "reconcile") {
          make(e, { ...base, tone: "recover", state: "info", title: `Checking whether “${label}” already happened`, detail: "Before any retry, so nothing is done twice." });
        } else if (decision === "repair") {
          make(e, { ...base, tone: "recover", state: "info", title: `Re-planning around a failed step: ${label}`, detail: reason });
        } else if (decision === "request_user") {
          make(e, { ...base, tone: "warning", state: "info", title: `Needs your help: ${label}`, detail: reason });
        } else if (decision === "block") {
          make(e, { ...base, tone: "danger", state: "failed", title: `Blocked: ${label}`, detail: reason ?? errorLabel(errorClass) });
        } else if (decision === "fail") {
          make(e, { ...base, tone: "danger", state: "failed", title: `Stopped trying: ${label}`, detail: reason ?? errorLabel(errorClass) });
        } else {
          make(e, { ...base, tone: "recover", state: "info", title: `Recovery decision for ${label}: ${humanize(decision).toLowerCase()}`, detail: reason });
        }
        break;
      }
      case "RECONCILIATION_REQUIRED": {
        const outcome = str(p, "outcome");
        const reason = str(p, "reason");
        const label = labelOf(e, p) ?? "an action";
        let title = `Outcome unknown: ${label}`;
        let detail: string | null = reason ? sentence(humanize(reason)) : null;
        if (outcome === "not_visible_yet") {
          title = `Result not visible yet: ${label}`;
          detail = "The provider does not show it yet; AgentOS will check again before deciding to retry.";
        } else if (outcome === "unknown") {
          title = `Couldn't confirm whether “${label}” happened`;
          detail = "Your confirmation is needed so it is not repeated by mistake.";
        } else if (reason === "worker_interrupted") {
          title = `Interrupted mid-action: ${label}`;
          detail = "Checking the external system before any retry.";
        }
        const entry = make(e, { kind: "recovery", phase: "recovery", tone: "recover", state: "waiting", title, detail });
        const ref = stepRef(e, p);
        const previous = openReconcile.get(ref);
        if (previous?.state === "waiting") previous.state = "info";
        openReconcile.set(ref, entry);
        break;
      }
      case "RECONCILIATION_RESOLVED": {
        const ref = stepRef(e, p);
        const open = openReconcile.get(ref);
        if (open?.state === "waiting") open.state = "done";
        openReconcile.delete(ref);
        const outcome = str(p, "outcome");
        const label = labelOf(e, p) ?? "the action";
        const byUser = e.actor_type === "user";
        const variants: Record<string, { title: string; tone: Tone }> = {
          found: { title: `Confirmed the earlier attempt took effect — not repeating “${label}”`, tone: "verify" },
          not_found: { title: `Confirmed “${label}” did not happen — safe to retry`, tone: "recover" },
          succeeded: { title: `You confirmed “${label}” happened`, tone: "success" },
          did_not_happen: { title: `You confirmed “${label}” did not happen — AgentOS will retry it`, tone: "recover" },
        };
        const v = (outcome && variants[outcome]) || { title: `Outcome resolved: ${label}`, tone: "recover" as Tone };
        make(e, { kind: "recovery", phase: "recovery", tone: v.tone, state: "done", title: v.title, actor: byUser ? "user" : e.actor_type });
        break;
      }
      case "BUDGET_EXCEEDED": {
        const budget = str(p, "budget");
        const limit = num(p, "limit");
        make(e, {
          kind: "budget",
          phase: "recovery",
          tone: "danger",
          state: "failed",
          title: `Execution limit reached: ${budget ? humanize(budget).toLowerCase() : "budget"}`,
          detail: limit !== null ? `Limit: ${limit}` : null,
        });
        break;
      }
      case "CANCEL_REQUESTED": {
        resolvePlanning();
        openCancel = make(e, { kind: "control", phase: "execution", tone: "neutral", state: "active", title: "Cancellation requested — stopping at the next safe point" });
        break;
      }
      case "TASK_PAUSED": {
        resolveLifecycle();
        make(e, { kind: "control", phase: "execution", tone: "neutral", state: "info", title: e.actor_type === "user" ? "Paused by you" : "Paused", detail: sentence(str(p, "reason")) });
        break;
      }
      case "TASK_RESUMED": {
        resolveLifecycle();
        make(e, { kind: "control", phase: "execution", tone: "accent", state: "info", title: e.actor_type === "user" ? "Resumed by you" : "Resumed" });
        break;
      }
      case "TASK_COMPLETED":
      case "TASK_FAILED":
      case "TASK_CANCELLED": {
        resolvePlanning();
        resolveLifecycle();
        if (openCancel?.state === "active") openCancel.state = "done";
        openCancel = null;
        const reason = str(p, "reason");
        if (type === "TASK_COMPLETED") {
          const direct = lastPlanSteps === 0;
          make(e, {
            kind: "task",
            phase: "outcome",
            tone: "success",
            state: "done",
            title: direct ? "Completed — answered directly, no actions taken" : reason === "all steps verified" ? "Completed — every action verified" : "Completed",
            detail: direct ? "The answer was not externally verified." : reason && reason !== "all steps verified" ? sentence(reason) : null,
          });
        } else if (type === "TASK_FAILED") {
          make(e, { kind: "task", phase: "outcome", tone: "danger", state: "failed", title: "The task did not complete", detail: reason ? errorLabel(null, reason) : null });
        } else {
          make(e, { kind: "task", phase: "outcome", tone: "neutral", state: "info", title: e.actor_type === "user" ? "Cancelled by you" : "Cancelled", detail: reason && reason !== "cancelled by user" ? sentence(reason) : null });
        }
        break;
      }
      default: {
        make(e, { kind: "generic", phase: phaseForUnknown(type), tone: "neutral", state: "info", title: humanize(type) });
      }
    }
  }

  // Nothing can still be in progress once no worker drives the task.
  if (taskStatus && !isTaskActive(taskStatus)) {
    for (const entry of entries) if (entry.state === "active") entry.state = "info";
  }
  // Waiting items are only still waiting if the task itself is waiting on someone.
  if (taskStatus && (taskStatus === "completed" || taskStatus === "cancelled")) {
    for (const entry of entries) if (entry.state === "waiting") entry.state = "info";
  }
  return entries.sort((a, b) => a.seq - b.seq);
}

// --------------------------------------------------------------------------------------------- grouping

const PHASE_LABELS: Record<TimelinePhase, string> = {
  planning: "Planning",
  execution: "Execution",
  verification: "Verification",
  recovery: "Recovery",
  approval: "Approval",
  outcome: "Result",
};

export function phaseLabel(phase: TimelinePhase, entries: readonly TimelineEntry[] = []): string {
  if (phase === "approval" && entries.length > 0 && entries.every((e) => e.kind === "input")) return "Your input";
  return PHASE_LABELS[phase];
}

/** Consecutive entries of the same phase form one group (the timeline reads as a story). */
export function groupByPhase(entries: readonly TimelineEntry[]): TimelinePhaseGroup[] {
  const groups: TimelinePhaseGroup[] = [];
  for (const entry of entries) {
    const last = groups[groups.length - 1];
    if (last && last.phase === entry.phase) last.entries.push(entry);
    else groups.push({ key: `g-${entry.key}`, phase: entry.phase, label: "", state: "done", entries: [entry] });
  }
  for (const g of groups) {
    g.label = phaseLabel(g.phase, g.entries);
    g.state = g.entries.some((e) => e.state === "active")
      ? "active"
      : g.entries.some((e) => e.state === "waiting")
        ? "waiting"
        : g.entries.some((e) => e.state === "failed")
          ? "failed"
          : "done";
  }
  return groups;
}

/** The most recent in-progress entry — "what is AgentOS doing right now?" (null when idle). */
export function currentActivity(entries: readonly TimelineEntry[]): TimelineEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].state === "active" || entries[i].state === "waiting") return entries[i];
  }
  return null;
}

export function buildTimeline(events: readonly TaskEvent[], options: NormalizeOptions = {}) {
  const entries = normalizeTimeline(events, options);
  return { entries, groups: groupByPhase(entries), current: currentActivity(entries) };
}
