/**
 * Task event sources for presentation surfaces (the landing page's interactive workflow).
 *
 * `TaskEventSource` is the seam: it yields the same shapes the product uses — durable `TaskEvent`s
 * ordered by `seq`, `StepOut` rows, a `TaskStatus` and `ApprovalOut`-shaped approval requests — so
 * the view renders exactly what the product's task timeline renders. `SimulatedTaskEventSource`
 * plays a deterministic, timed script in the browser; a live, authenticated implementation (REST
 * backfill + SSE via `@/lib/realtime`, approvals via `approvalsApi`) can replace it without touching
 * the view.
 *
 * The simulation never performs network requests and never claims otherwise.
 */
import type { ApprovalOut, EventType, StepOut, TaskEvent, TaskStatus } from "@/lib/api";
import {
  planSteps,
  schedulingScenario,
  tomorrowSlot,
  type EmitBeat,
  type Scenario,
  type ScenarioBeat,
  type ScenarioContext,
  type ScenarioStepKey,
} from "./scheduling-scenario";

export interface DemoTask {
  id: string;
  goal: string;
  context: string | null;
  status: TaskStatus;
  plan_version: number;
  /** `task.plan` once the plan is persisted (PLAN_CREATED). */
  plan: Record<string, unknown> | null;
  created_at: string | null;
}

/** The fields of an approval request the demo surfaces (same names and types as `ApprovalOut`). */
export type DemoApproval = Pick<
  ApprovalOut,
  | "id"
  | "task_id"
  | "step_id"
  | "tool_name"
  | "summary"
  | "target"
  | "risk_level"
  | "permission_level"
  | "reasons"
  | "arguments_preview"
  | "status"
  | "created_at"
  | "expires_at"
>;

export interface TaskRunSnapshot {
  task: DemoTask;
  /** Plan steps ordered by position (empty until PLAN_CREATED). */
  steps: StepOut[];
  /** Durable events, contiguous `seq` from 1. */
  events: TaskEvent[];
  approvals: DemoApproval[];
  /** The approval the run is currently waiting on, if any. */
  pendingApproval: DemoApproval | null;
  /** True once the task reached a resting/terminal state and no more events will arrive. */
  finished: boolean;
}

/** Called after every appended event (and with `null` after resets). */
export type TaskEventListener = (event: TaskEvent | null, snapshot: TaskRunSnapshot) => void;

export interface TaskEventSource {
  readonly kind: "simulated" | "live";
  getSnapshot(): TaskRunSnapshot;
  /** Compatible with `useSyncExternalStore` (the listener may ignore its arguments). */
  subscribe(listener: TaskEventListener): () => void;
  start(): void;
  /** Resolves once the decision is recorded; rejects when the approval is not pending (409 in the API). */
  approve(approvalId: string): Promise<void>;
  reject(approvalId: string, reason?: string): Promise<void>;
  reset(): void;
  dispose(): void;
}

export class ApprovalNotPendingError extends Error {
  readonly code = "approval_not_pending";
  constructor(approvalId: string) {
    super(`Approval ${approvalId} is not pending`);
    this.name = "ApprovalNotPendingError";
  }
}

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

// Deterministic, UUID-shaped identifiers (clearly simulated: the node field reads "5e1ad0…").
const SIM_TASK_ID = "01926f3a-0000-7000-8000-5e1ad0000001";
const STEP_IDS: Record<ScenarioStepKey, string> = {
  find_slot: "01926f3a-0001-7000-8000-5e1ad0000011",
  find_contact: "01926f3a-0002-7000-8000-5e1ad0000012",
  create_meeting: "01926f3a-0003-7000-8000-5e1ad0000013",
  send_confirmation: "01926f3a-0004-7000-8000-5e1ad0000014",
};
const APPROVAL_IDS: Record<ScenarioStepKey, string> = {
  find_slot: "01926f3a-00a1-7000-8000-5e1ad00000a1",
  find_contact: "01926f3a-00a2-7000-8000-5e1ad00000a2",
  create_meeting: "01926f3a-00a3-7000-8000-5e1ad00000a3",
  send_confirmation: "01926f3a-00a4-7000-8000-5e1ad00000a4",
};

const RESTING: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled", "expired", "blocked"]);
const STATE_EVENTS: ReadonlySet<string> = new Set<EventType>([
  "TASK_STATE_CHANGED",
  "TASK_COMPLETED",
  "TASK_FAILED",
  "TASK_CANCELLED",
  "TASK_PAUSED",
  "TASK_RESUMED",
  "CANCEL_REQUESTED",
]);

export function initialSnapshot(scenario: Scenario = schedulingScenario): TaskRunSnapshot {
  return {
    task: {
      id: SIM_TASK_ID,
      goal: scenario.goal,
      context: scenario.context,
      status: "created",
      plan_version: 0,
      plan: null,
      created_at: null,
    },
    steps: [],
    events: [],
    approvals: [],
    pendingApproval: null,
    finished: false,
  };
}

export interface ReducerContext {
  scenario: Scenario;
  scenarioContext: ScenarioContext;
}

function patchStep(steps: StepOut[], stepId: string | null, patch: (s: StepOut) => Partial<StepOut>): StepOut[] {
  if (!stepId) return steps;
  return steps.map((s) => (s.id === stepId ? { ...s, ...patch(s) } : s));
}

/**
 * Pure projection of one event onto the run snapshot — the same information the product reads from
 * the task detail (steps, status) after each event. Events must arrive in `seq` order.
 */
export function applyTaskEvent(snap: TaskRunSnapshot, event: TaskEvent, rc: ReducerContext): TaskRunSnapshot {
  const p = event.payload as Record<string, unknown>;
  const at = event.created_at;
  let { task, steps, approvals, pendingApproval } = snap;
  const stepKey = steps.find((s) => s.id === event.step_id)?.step_key as ScenarioStepKey | undefined;
  const template = stepKey ? rc.scenario.steps.find((s) => s.key === stepKey) : undefined;

  if (STATE_EVENTS.has(event.event_type) && typeof p.to === "string") {
    task = { ...task, status: p.to as TaskStatus };
  }

  switch (event.event_type as EventType) {
    case "TASK_CREATED":
      task = { ...task, created_at: at };
      break;
    case "PLAN_CREATED":
      task = { ...task, plan_version: Number(p.plan_version ?? 1), plan: rc.scenario.plan };
      steps = planSteps(rc.scenario, (k) => STEP_IDS[k]);
      break;
    case "TOOL_CALL_STARTED":
      steps = patchStep(steps, event.step_id, (s) => ({
        status: "running",
        attempt_count: s.attempt_count + 1,
        started_at: s.started_at ?? at,
      }));
      break;
    case "TOOL_CALL_FINISHED": {
      const result = template?.result(rc.scenarioContext);
      steps = patchStep(steps, event.step_id, () => ({
        status: "verifying",
        output_summary: result?.output_summary ?? (p.summary as string | undefined) ?? null,
        external_ref: result?.external_ref ?? null,
        output_trust: result?.output_trust ?? null,
      }));
      break;
    }
    case "VERIFICATION_STARTED":
      steps = patchStep(steps, event.step_id, () => ({ status: "verifying" }));
      break;
    case "VERIFICATION_PASSED":
      steps = patchStep(steps, event.step_id, () => ({ verification_status: "passed" }));
      break;
    case "VERIFICATION_FAILED":
      steps = patchStep(steps, event.step_id, () => ({ verification_status: "failed" }));
      break;
    case "STEP_COMPLETED":
      steps = patchStep(steps, event.step_id, () => ({ status: "completed", completed_at: at }));
      break;
    case "STEP_FAILED":
      steps = patchStep(steps, event.step_id, () => ({
        status: "failed",
        completed_at: at,
        error_class: (p.error_class as string | undefined) ?? null,
        error_message: (p.error as string | undefined) ?? null,
      }));
      break;
    case "STEP_SKIPPED":
      steps = patchStep(steps, event.step_id, () => ({ status: "skipped", verification_status: "not_applicable" }));
      break;
    case "APPROVAL_REQUIRED": {
      const step = steps.find((s) => s.id === event.step_id);
      const preview = template?.approval?.(rc.scenarioContext);
      const approval: DemoApproval = {
        id: String(p.approval_id),
        task_id: task.id,
        step_id: event.step_id ?? "",
        tool_name: step?.tool_name ?? "",
        summary: String(p.summary ?? preview?.summary ?? ""),
        target: preview?.target ?? null,
        risk_level: (p.risk_level as DemoApproval["risk_level"]) ?? step?.risk_level ?? "high",
        permission_level: step?.permission_level ?? "write",
        reasons: step?.policy_reasons ?? [],
        arguments_preview: preview?.arguments_preview ?? {},
        status: "pending",
        created_at: at,
        expires_at: String(p.expires_at ?? at),
      };
      approvals = [...approvals, approval];
      pendingApproval = approval;
      steps = patchStep(steps, event.step_id, () => ({ status: "waiting_approval", approval_request_id: approval.id }));
      break;
    }
    case "APPROVAL_GRANTED":
    case "APPROVAL_REJECTED": {
      const status = event.event_type === "APPROVAL_GRANTED" ? "approved" : "rejected";
      approvals = approvals.map((a) => (a.id === p.approval_id ? { ...a, status } : a));
      if (pendingApproval?.id === p.approval_id) pendingApproval = null;
      if (status === "approved") steps = patchStep(steps, event.step_id, () => ({ status: "pending" }));
      break;
    }
    default:
      break;
  }

  return {
    task,
    steps,
    approvals,
    pendingApproval,
    events: [...snap.events, event],
    finished: RESTING.has(task.status),
  };
}

export interface SimulatedSourceOptions {
  scenario?: Scenario;
  /** Playback speed multiplier (2 = twice as fast). */
  speed?: number;
  clock?: Clock;
}

/**
 * Plays the scenario as a deterministic timed script. The run halts at every approval gate until
 * `approve`/`reject` is called with the pending approval's id; approvals are single-use.
 */
export class SimulatedTaskEventSource implements TaskEventSource {
  readonly kind = "simulated" as const;
  private readonly scenario: Scenario;
  private readonly clock: Clock;
  private readonly speed: number;
  private listeners = new Set<TaskEventListener>();
  private snapshot: TaskRunSnapshot;
  private queue: ScenarioBeat[] = [];
  private gate: Extract<ScenarioBeat, { kind: "gate" }> | null = null;
  private timer: unknown = null;
  private started = false;
  private disposed = false;
  private ctx: ScenarioContext | null = null;

  constructor(options: SimulatedSourceOptions = {}) {
    this.scenario = options.scenario ?? schedulingScenario;
    this.clock = options.clock ?? systemClock;
    this.speed = options.speed && options.speed > 0 ? options.speed : 1;
    this.snapshot = initialSnapshot(this.scenario);
  }

  getSnapshot = (): TaskRunSnapshot => this.snapshot;

  subscribe = (listener: TaskEventListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  get isRunning(): boolean {
    return this.started && !this.snapshot.finished && this.gate === null;
  }

  start(): void {
    if (this.disposed || this.started) return;
    this.started = true;
    const startedAt = this.clock.now();
    this.ctx = {
      startedAt,
      at: startedAt,
      slot: tomorrowSlot(startedAt),
      approvalId: (k) => APPROVAL_IDS[k],
      stepId: (k) => STEP_IDS[k],
    };
    this.queue = [...this.scenario.beats];
    this.next();
  }

  approve(approvalId: string): Promise<void> {
    return this.decide(approvalId, "approve");
  }

  reject(approvalId: string): Promise<void> {
    return this.decide(approvalId, "reject");
  }

  reset(): void {
    this.cancelTimer();
    this.started = false;
    this.gate = null;
    this.queue = [];
    this.ctx = null;
    this.snapshot = initialSnapshot(this.scenario);
    this.notify(null);
  }

  dispose(): void {
    this.cancelTimer();
    this.disposed = true;
    this.listeners.clear();
  }

  private decide(approvalId: string, decision: "approve" | "reject"): Promise<void> {
    const gate = this.gate;
    const pending = this.snapshot.pendingApproval;
    if (!gate || !pending || pending.id !== approvalId || this.disposed) {
      return Promise.reject(new ApprovalNotPendingError(approvalId));
    }
    this.gate = null; // single use: a second decision on the same approval is rejected
    this.queue = decision === "approve" ? [...gate.onApprove, ...this.queue] : [...gate.onReject];
    this.next();
    return Promise.resolve();
  }

  private next(): void {
    if (this.disposed) return;
    const beat = this.queue.shift();
    if (!beat) return;
    if (beat.kind === "gate") {
      this.gate = beat;
      return;
    }
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.emit(beat);
      this.next();
    }, beat.delay / this.speed);
  }

  private emit(beat: EmitBeat): void {
    if (!this.ctx) return;
    const at = this.clock.now();
    this.ctx = { ...this.ctx, at };
    const spec = beat.event;
    const event: TaskEvent = {
      seq: this.snapshot.events.length + 1,
      event_type: spec.type,
      actor_type: spec.actor ?? "system",
      step_id: spec.step ? STEP_IDS[spec.step] : null,
      payload: spec.payload ? spec.payload(this.ctx) : {},
      created_at: new Date(at).toISOString(),
      task_id: this.snapshot.task.id,
    };
    this.snapshot = applyTaskEvent(this.snapshot, event, { scenario: this.scenario, scenarioContext: this.ctx });
    this.notify(event);
  }

  private notify(event: TaskEvent | null): void {
    for (const l of [...this.listeners]) l(event, this.snapshot);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.clock.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Presentation phases of the demo, derived from durable state (never from animation timing). */
export type DemoPhase =
  | "idle"
  | "understanding"
  | "planning"
  | "calendar_lookup"
  | "approval"
  | "calendar_action"
  | "verification"
  | "gmail_confirmation"
  | "completed"
  | "failed";

export const DEMO_PHASES: ReadonlyArray<{ id: Exclude<DemoPhase, "idle" | "failed">; label: string }> = [
  { id: "understanding", label: "Understanding goal" },
  { id: "planning", label: "Planning" },
  { id: "calendar_lookup", label: "Calendar lookup" },
  { id: "approval", label: "Approval" },
  { id: "calendar_action", label: "Calendar action" },
  { id: "verification", label: "Verification" },
  { id: "gmail_confirmation", label: "Gmail confirmation" },
  { id: "completed", label: "Verified & complete" },
];

export function derivePhase(snap: TaskRunSnapshot): DemoPhase {
  const { task, steps, events } = snap;
  if (events.length === 0) return "idle";
  if (task.status === "completed") return "completed";
  if (task.status === "failed") return "failed";
  const byKey = (k: ScenarioStepKey) => steps.find((s) => s.step_key === k);
  const meeting = byKey("create_meeting");
  const mail = byKey("send_confirmation");
  if (task.status === "verifying") return "verification";
  if (mail && mail.status !== "pending" && mail.status !== "skipped") return "gmail_confirmation";
  if (meeting && (meeting.status === "verifying" || meeting.status === "completed")) {
    return meeting.status === "completed" ? "gmail_confirmation" : "verification";
  }
  if (meeting?.status === "running") return "calendar_action";
  if (task.status === "waiting_approval" || snap.pendingApproval) return "approval";
  if (meeting?.status === "pending" && snap.approvals.some((a) => a.status === "approved")) return "calendar_action";
  if (task.status === "running") return "calendar_lookup";
  if (task.plan_version > 0 || task.status === "planned" || task.status === "validating" || task.status === "queued") {
    return "planning";
  }
  return "understanding";
}
