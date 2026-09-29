/**
 * In-memory state of the demo backend (one workspace, one signed-in demo user), plus the generic
 * write helpers every domain uses: task events (+ bus fan-out), execution logs, notifications,
 * audit records and usage metering. Records are shaped like the API models so responses are cheap.
 */
import type {
  AcbeExperimentOut,
  AgentVersionOut,
  ApprovalOut,
  AuditOut,
  AutomationOut,
  AutomationRunOut,
  CandidateOut,
  ConnectionOut,
  EvaluationExperimentOut,
  EvaluationRunDetail,
  EventType,
  ExecutionLogOut,
  FailurePatternOut,
  FileOut,
  McpServerOut,
  McpToolOut,
  MemberOut,
  MemoryOut,
  NotificationEvent,
  NotificationOut,
  OrganizationOut,
  OrganizationPolicy,
  PermissionLevel,
  RiskLevel,
  SessionOut,
  StepStatus,
  TaskEventOut,
  TaskStatus,
  ToolRuleOut,
  UserOut,
  VerificationOut,
  VerificationStatus,
} from "@/lib/api";
import { type Scheduler } from "./clock";
import { EventBus } from "./sse";
import { iso, uuid } from "./util";

export interface TaskRec {
  id: string;
  userId: string;
  agentId: string | null;
  agentVersionId: string | null;
  agentLabel: Record<string, unknown> | null;
  goal: string;
  context: string | null;
  priority: number;
  source: "api" | "automation";
  idempotencyKey: string | null;
  automationRunId: string | null;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  progress: number;
  planVersion: number;
  plan: Record<string, unknown> | null;
  modelCalls: number;
  toolCalls: number;
  failureCode: string | null;
  failureMessage: string | null;
  pendingQuestions: string[] | null;
  resultSummary: Record<string, unknown> | null;
  userInputs: { question: string; answer: string; at: string }[];
  pendingInput: { stepId: string; stepKey: string; question: string; details: Record<string, unknown> } | null;
  cancelRequested: boolean;
  pauseRequested: boolean;
  replans: number;
  policyVersion: number | null;
  events: TaskEventOut[];
  logs: ExecutionLogOut[];
  /** Scenario knobs of the simulated providers (e.g. how many calendar calls still fail). */
  sim: { flakyFailures: number };
}

export interface StepRec {
  id: string;
  taskId: string;
  planVersion: number;
  key: string;
  position: number;
  action: string;
  tool: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  dependencies: string[];
  modelRequiresApproval: boolean;
  permissionLevel: PermissionLevel;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  policyReasons: string[];
  verificationMethod: string;
  status: StepStatus;
  attemptCount: number;
  maxAttempts: number;
  startedAt: string | null;
  completedAt: string | null;
  nextAttemptAt: number | null;
  resolvedArgs: Record<string, unknown> | null;
  actionHash: string | null;
  output: Record<string, unknown> | null;
  outputSummary: string | null;
  outputTrust: string | null;
  externalRef: string | null;
  errorClass: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  verificationStatus: VerificationStatus;
  approvalRequestId: string | null;
}

export type ApprovalRec = ApprovalOut & { actionHash: string };
export type VerificationRec = VerificationOut & { taskId: string };
export type NotificationRec = NotificationOut & { userId: string; idemKey: string };
export type FileRec = FileOut & { blob: Blob | null; text: string | null };
export type MemoryRec = Omit<MemoryOut, "freshness"> & { userId: string };
export type McpToolRec = McpToolOut;
export type EvaluationRunRec = EvaluationRunDetail;
export type ExperimentRec = EvaluationExperimentOut;
export type CandidateRec = CandidateOut & { experiments: AcbeExperimentOut[] };

export interface AgentRec {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  current_version_id: string | null;
  deleted: boolean;
}

export interface MeRec extends UserOut {
  role: string;
  permissions: string[];
  tenant_id: string;
}

export interface Usage {
  totals: Record<string, number>;
  costUsd: number;
  /** date → kind → quantity */
  byDay: Map<string, Map<string, number>>;
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: string[];
}

export interface IdempotentRecord {
  fingerprint: string;
  status: number;
  body: unknown;
}

export class DemoStore {
  readonly bus = new EventBus();
  sched: Scheduler;

  me!: MeRec;
  org!: OrganizationOut;
  members: MemberOut[] = [];
  sessions: SessionOut[] = [];
  policy!: { policy: OrganizationPolicy; version: number };

  tasks = new Map<string, TaskRec>();
  steps = new Map<string, StepRec>();
  approvals = new Map<string, ApprovalRec>();
  verifications: VerificationRec[] = [];

  agents: AgentRec[] = [];
  agentVersions: AgentVersionOut[] = [];
  toolRules: ToolRuleOut[] = [];
  connections: ConnectionOut[] = [];
  memories: MemoryRec[] = [];
  files: FileRec[] = [];
  automations: AutomationOut[] = [];
  automationRuns: AutomationRunOut[] = [];
  auditLog: AuditOut[] = [];
  notifications: NotificationRec[] = [];
  usage: Usage = { totals: {}, costUsd: 0, byDay: new Map() };
  mcpServers: McpServerOut[] = [];
  mcpTools: McpToolRec[] = [];
  evaluationRuns: EvaluationRunRec[] = [];
  experiments: ExperimentRec[] = [];
  failurePatterns: FailurePatternOut[] = [];
  candidates: CandidateRec[] = [];
  calendar: CalendarEvent[] = [];
  sentMail: { id: string; to: string[]; subject: string; body: string; draft: boolean; at: string }[] = [];

  /** (user, key, route) → stored response, for Idempotency-Key replay. */
  idempotency = new Map<string, IdempotentRecord>();

  auth = {
    signedOut: false,
    sessionId: uuid(),
    accessTokens: new Set<string>(),
    refreshTokens: new Set<string>(),
    streamTokens: new Map<string, number>(),
    oauthStates: new Set<string>(),
  };

  constructor(sched: Scheduler) {
    this.sched = sched;
  }

  now(): number {
    return this.sched.now();
  }

  nowIso(): string {
    return iso(this.sched.now());
  }

  // ------------------------------------------------------------------ tasks
  stepsOf(task: TaskRec, planVersion: number | null = task.planVersion): StepRec[] {
    const out: StepRec[] = [];
    for (const s of this.steps.values()) {
      if (s.taskId === task.id && (planVersion === null || s.planVersion === planVersion)) out.push(s);
    }
    return out.sort((a, b) => a.planVersion - b.planVersion || a.position - b.position);
  }

  /** Append an immutable task event (gap-free seq) and fan it out to the task and user channels. */
  appendEvent(
    task: TaskRec,
    type: EventType,
    opts: { payload?: Record<string, unknown>; stepId?: string | null; actorType?: string } = {},
  ): TaskEventOut {
    const seq = task.events.length + 1;
    const event: TaskEventOut = {
      seq,
      event_type: type,
      step_id: opts.stepId ?? null,
      actor_type: opts.actorType ?? "system",
      payload: opts.payload ?? {},
      created_at: this.nowIso(),
    };
    task.events.push(event);
    task.updatedAt = event.created_at;
    this.bus.publishTask(task.id);
    this.bus.publishUser(task.userId, {
      type: type as Exclude<EventType, "NOTIFICATION_CREATED">,
      task_id: task.id,
      seq,
      event_type: type as Exclude<EventType, "NOTIFICATION_CREATED">,
      status: task.status,
      step_id: event.step_id,
    });
    return event;
  }

  log(task: TaskRec, step: StepRec | null, level: "info" | "warning" | "error", message: string): void {
    task.logs.push({ created_at: this.nowIso(), level, message: message.slice(0, 1000), step_id: step?.id ?? null });
  }

  // ------------------------------------------------------------------ notifications
  notify(
    userId: string,
    event: NotificationEvent,
    title: string,
    body: string,
    data: Record<string, unknown>,
    idemKey: string,
  ): void {
    if (this.notifications.some((n) => n.userId === userId && n.idemKey === idemKey)) return;
    const n: NotificationRec = {
      id: uuid(),
      userId,
      idemKey,
      channel: "in_app",
      event_type: event,
      title: title.slice(0, 300),
      body: body.slice(0, 5000),
      data,
      status: "delivered",
      read_at: null,
      created_at: this.nowIso(),
    };
    this.notifications.push(n);
    this.bus.publishUser(userId, { type: "NOTIFICATION_CREATED", notification_id: n.id, event, title: n.title });
  }

  // ------------------------------------------------------------------ audit & usage
  audit(entry: Partial<AuditOut> & { category: string; action: string }, requestId: string | null = null): void {
    const worker = entry.actor_type === "worker" || entry.actor_type === "system";
    this.auditLog.push({
      id: uuid(),
      tenant_id: this.org.id,
      user_id: this.me.id,
      actor_type: "user",
      status: "success",
      approval_id: null,
      ip_address: worker ? null : "203.0.113.24",
      metadata: {},
      request_id: worker ? null : requestId,
      resource_id: null,
      resource_type: null,
      result_summary: null,
      step_id: null,
      task_id: null,
      tool_name: null,
      created_at: this.nowIso(),
      ...entry,
    } as AuditOut);
  }

  addUsage(kind: string, quantity = 1, costUsd = 0): void {
    this.usage.totals[kind] = (this.usage.totals[kind] ?? 0) + quantity;
    this.usage.costUsd += costUsd;
    const day = this.nowIso().slice(0, 10);
    const kinds = this.usage.byDay.get(day) ?? new Map<string, number>();
    kinds.set(kind, (kinds.get(kind) ?? 0) + quantity);
    this.usage.byDay.set(day, kinds);
  }

  /** Scopes granted by the connected Google account (empty when disconnected). */
  googleScopes(): Set<string> {
    const conn = this.connections.find((c) => c.provider === "google" && c.status === "connected");
    return new Set(conn?.scopes ?? []);
  }
}
