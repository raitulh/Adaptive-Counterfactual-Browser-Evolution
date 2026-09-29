/**
 * Demo data: the scripted run behind the landing page's interactive workflow.
 *
 * It mirrors the backend's acceptance scenario (backend/docs/agent-execution.md → "Worked example"):
 * the same plan shape, tools, permission levels, verification methods and event order — two reads
 * in parallel, then one approval per side effect (approvals are bound to the exact action), a
 * read-back after every write and a final verification before the task may complete.
 *
 * Everything here is fiction for the simulation: no request is made and no account is touched.
 */
import type { EventType, PermissionLevel, RiskLevel, StepOut } from "@/lib/api";

export type ScenarioStepKey = "find_slot" | "find_rahim" | "create_meeting" | "send_confirmation";

/** Context passed to payload builders so times can be expressed relative to "now". */
export interface ScenarioContext {
  /** Epoch ms when the run started (from the injected clock). */
  startedAt: number;
  /** Epoch ms of the event being built. */
  at: number;
  approvalId: (step: ScenarioStepKey) => string;
  stepId: (step: ScenarioStepKey) => string;
  /** Tomorrow's meeting slot, derived from the start time (15:00–15:30 local). */
  slot: { start: Date; end: Date };
}

export interface ScenarioEventSpec {
  type: EventType;
  step?: ScenarioStepKey;
  actor?: "user" | "system" | "agent";
  payload?: (ctx: ScenarioContext) => Record<string, unknown>;
}

/** Wait `delay` ms (at speed 1), then append one durable event. */
export interface EmitBeat {
  kind: "emit";
  delay: number;
  event: ScenarioEventSpec;
}

/** The run stops here until the visitor approves or rejects the step's approval request. */
export interface GateBeat {
  kind: "gate";
  step: ScenarioStepKey;
  onApprove: ScenarioBeat[];
  onReject: ScenarioBeat[];
}

export type ScenarioBeat = EmitBeat | GateBeat;

export interface ScenarioStepTemplate {
  key: ScenarioStepKey;
  action: string;
  tool_name: string;
  tool_version: string;
  permission_level: PermissionLevel;
  risk_level: RiskLevel;
  requires_approval: boolean;
  verification_method: string;
  policy_reasons: string[];
  /** Applied when the tool call finishes (what the step reports and which object it produced). */
  result: (ctx: ScenarioContext) => { output_summary: string; external_ref: string | null; output_trust: string };
  /** Approval preview for side-effecting steps (redacted arguments, as the backend would show them). */
  approval?: (ctx: ScenarioContext) => { summary: string; target: string; arguments_preview: Record<string, unknown> };
}

export interface Scenario {
  goal: string;
  context: string;
  planSummary: string;
  steps: ScenarioStepTemplate[];
  beats: ScenarioBeat[];
  /** Pending approvals expire after this long (display only; the simulation never expires them). */
  approvalTtlMs: number;
}

const emit = (delay: number, event: ScenarioEventSpec): EmitBeat => ({ kind: "emit", delay, event });

const state = (from: string, to: string, reason: string, actor: ScenarioEventSpec["actor"] = "system") =>
  ({
    type: "TASK_STATE_CHANGED",
    actor,
    payload: () => ({ from, to, reason }),
  }) satisfies ScenarioEventSpec;

const fmtTime = (d: Date) =>
  d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

export const RAHIM = { name: "Rahim Chowdhury", email: "rahim@example.org" } as const;

/** The meeting slot the simulated calendar returns: tomorrow 15:00–15:30 in the visitor's time zone. */
export function tomorrowSlot(startedAt: number): { start: Date; end: Date } {
  const start = new Date(startedAt);
  start.setDate(start.getDate() + 1);
  start.setHours(15, 0, 0, 0);
  return { start, end: new Date(start.getTime() + 30 * 60_000) };
}

/** Beats for one side-effecting step after its approval was granted: run → read back → complete. */
function afterApproval(step: ScenarioStepKey, tool: string, action: string, readBack: { started: string; passed: string }) {
  return [
    emit(150, { type: "APPROVAL_GRANTED", step, actor: "user", payload: (c) => ({ approval_id: c.approvalId(step) }) }),
    emit(250, state("waiting_approval", "queued", "approval granted", "user")),
    emit(350, state("queued", "running", "worker acquired task")),
    emit(350, {
      type: "TOOL_CALL_STARTED",
      step,
      payload: () => ({ step, tool, attempt: 1, action }),
    }),
    emit(1000, {
      type: "TOOL_CALL_FINISHED",
      step,
      payload: (c) => ({ step, tool, summary: scenarioResult(step, c).output_summary, duration_ms: 842 }),
    }),
    emit(300, { type: "VERIFICATION_STARTED", step, payload: () => ({ step, method: readBack.started }) }),
    emit(900, { type: "VERIFICATION_PASSED", step, payload: () => ({ step, method: readBack.passed }) }),
    emit(250, {
      type: "STEP_COMPLETED",
      step,
      payload: (c) => ({ step, summary: scenarioResult(step, c).output_summary }),
    }),
  ];
}

/** Beats after a rejection: the step fails honestly, dependants are skipped, nothing is claimed. */
function afterRejection(step: ScenarioStepKey, skipped: ScenarioStepKey[]): EmitBeat[] {
  return [
    emit(150, {
      type: "APPROVAL_REJECTED",
      step,
      actor: "user",
      payload: (c) => ({ approval_id: c.approvalId(step), reason: "Rejected in the simulation" }),
    }),
    emit(250, state("waiting_approval", "queued", "approval rejected", "user")),
    emit(350, state("queued", "running", "worker acquired task")),
    emit(300, {
      type: "STEP_FAILED",
      step,
      payload: () => ({ step, error: "approval_rejected", error_class: "policy" }),
    }),
    ...skipped.map((s) =>
      emit(200, { type: "STEP_SKIPPED", step: s, payload: () => ({ step: s, reason: "a prerequisite did not complete" }) }),
    ),
    emit(450, {
      type: "TASK_FAILED",
      payload: () => ({ from: "running", to: "failed", reason: "approval rejected — nothing was sent" }),
    }),
  ];
}

function approvalRequest(step: ScenarioStepKey, summaryOf: (c: ScenarioContext) => string): ScenarioEventSpec {
  return {
    type: "APPROVAL_REQUIRED",
    step,
    payload: (c) => ({
      approval_id: c.approvalId(step),
      summary: summaryOf(c),
      risk_level: "high",
      expires_at: new Date(c.at + SCHEDULING_SCENARIO_TTL_MS).toISOString(),
    }),
  };
}

const SCHEDULING_SCENARIO_TTL_MS = 15 * 60_000;

const STEPS: ScenarioStepTemplate[] = [
  {
    key: "find_slot",
    action: "Find a free 30-minute slot tomorrow",
    tool_name: "calendar.find_free_slots",
    tool_version: "v1",
    permission_level: "read",
    risk_level: "low",
    requires_approval: false,
    verification_method: "output_schema",
    policy_reasons: [],
    result: (c) => ({
      output_summary: `3 free slots tomorrow; first at ${fmtTime(c.slot.start)}`,
      external_ref: null,
      output_trust: "controlled_agent_output",
    }),
  },
  {
    key: "find_rahim",
    action: "Look up Rahim's e-mail address",
    tool_name: "contacts.lookup",
    tool_version: "v1",
    permission_level: "read",
    risk_level: "low",
    requires_approval: false,
    verification_method: "output_schema",
    policy_reasons: [],
    result: () => ({
      output_summary: `${RAHIM.name} <${RAHIM.email}>`,
      external_ref: null,
      output_trust: "controlled_agent_output",
    }),
  },
  {
    key: "create_meeting",
    action: "Schedule a 30-minute meeting with Rahim",
    tool_name: "calendar.create_event",
    tool_version: "v1",
    permission_level: "write",
    risk_level: "high",
    requires_approval: true,
    verification_method: "read_back",
    policy_reasons: ["Invites another person", "Attendee is outside your organization"],
    result: (c) => ({
      output_summary: `Created “Meeting with Rahim” tomorrow ${fmtTime(c.slot.start)}–${fmtTime(c.slot.end)}`,
      external_ref: "evt_sim_7c1f2a9d",
      output_trust: "controlled_agent_output",
    }),
    approval: (c) => ({
      summary: `Create calendar event “Meeting with Rahim” tomorrow ${fmtTime(c.slot.start)}–${fmtTime(c.slot.end)} and invite ${RAHIM.email}`,
      target: RAHIM.email,
      arguments_preview: {
        title: "Meeting with Rahim",
        start: c.slot.start.toISOString(),
        end: c.slot.end.toISOString(),
        attendees: [RAHIM.email],
      },
    }),
  },
  {
    key: "send_confirmation",
    action: "Send Rahim a confirmation e-mail",
    tool_name: "gmail.send",
    tool_version: "v1",
    permission_level: "high_risk_write",
    risk_level: "high",
    requires_approval: true,
    verification_method: "provider_confirmation",
    policy_reasons: ["Sends e-mail on your behalf"],
    result: () => ({
      output_summary: `Sent “Meeting confirmation” to ${RAHIM.email}`,
      external_ref: "msg_sim_3b8e40f1",
      output_trust: "controlled_agent_output",
    }),
    approval: (c) => ({
      summary: `Send e-mail “Meeting confirmation” to ${RAHIM.email}`,
      target: RAHIM.email,
      arguments_preview: {
        to: [RAHIM.email],
        subject: "Meeting confirmation",
        body: `Hi Rahim, confirming our meeting tomorrow at ${fmtTime(c.slot.start)} (30 min). The invite is in your calendar.`,
      },
    }),
  },
];

function scenarioResult(step: ScenarioStepKey, c: ScenarioContext) {
  return STEPS.find((s) => s.key === step)!.result(c);
}

const readStep = (step: ScenarioStepKey, tool: string, action: string): EmitBeat[] => [
  emit(450, { type: "TOOL_CALL_STARTED", step, payload: () => ({ step, tool, attempt: 1, action }) }),
];

const finishRead = (step: ScenarioStepKey, tool: string, ms: number): EmitBeat[] => [
  emit(ms, {
    type: "TOOL_CALL_FINISHED",
    step,
    payload: (c) => ({ step, tool, summary: scenarioResult(step, c).output_summary, duration_ms: 412 }),
  }),
  emit(250, { type: "VERIFICATION_STARTED", step, payload: () => ({ step, method: "output_schema" }) }),
  emit(550, { type: "VERIFICATION_PASSED", step, payload: () => ({ step, method: "output_schema" }) }),
  emit(250, { type: "STEP_COMPLETED", step, payload: (c) => ({ step, summary: scenarioResult(step, c).output_summary }) }),
];

/**
 * "Find a free 30-minute slot tomorrow, schedule a meeting, and send a confirmation."
 * 41 events on the approve/approve path — the same sequence the backend's end-to-end test records.
 */
export const schedulingScenario: Scenario = {
  goal: "Find a free 30-minute slot tomorrow, schedule a meeting, and send a confirmation.",
  context: "The meeting is with Rahim.",
  planSummary:
    "Find tomorrow's first free 30-minute slot, look up Rahim, create the event with him as attendee, then e-mail him a confirmation.",
  steps: STEPS,
  approvalTtlMs: SCHEDULING_SCENARIO_TTL_MS,
  beats: [
    // Understanding the goal
    emit(350, { type: "TASK_CREATED", actor: "user", payload: () => ({ source: "web" }) }),
    emit(450, state("created", "planning", "planning started")),
    emit(300, { type: "PLANNING_STARTED", payload: () => ({ replan: false }) }),
    // Planning (the model proposes; the validator decides)
    emit(1300, state("planning", "planned", "plan created")),
    emit(250, {
      type: "PLAN_CREATED",
      payload: () => ({ plan_version: 1, steps: 4, summary: schedulingScenarioPlanSummary() }),
    }),
    emit(500, state("planned", "validating", "validating plan")),
    emit(700, { type: "PLAN_VALIDATED", payload: () => ({ plan_version: 1, approvals_expected: 2 }) }),
    emit(350, state("validating", "queued", "plan validated")),
    emit(400, state("queued", "running", "worker acquired task")),
    // Calendar lookup + contact lookup: parallel-safe reads
    ...readStep("find_slot", "calendar.find_free_slots", "Find free 30-minute slots tomorrow"),
    emit(120, {
      type: "TOOL_CALL_STARTED",
      step: "find_rahim",
      payload: () => ({ step: "find_rahim", tool: "contacts.lookup", attempt: 1, action: "Look up contact “Rahim”" }),
    }),
    ...finishRead("find_slot", "calendar.find_free_slots", 800),
    ...finishRead("find_rahim", "contacts.lookup", 300),
    // Approval for the calendar write — nothing has been written yet
    emit(600, approvalRequest("create_meeting", (c) => STEPS[2].approval!(c).summary)),
    emit(200, state("running", "waiting_approval", "approval required")),
    {
      kind: "gate",
      step: "create_meeting",
      onApprove: [
        ...afterApproval("create_meeting", "calendar.create_event", "Create “Meeting with Rahim” tomorrow", {
          started: "read_back",
          passed: "read_back",
        }),
        // Approval for the e-mail — a separate action needs its own approval
        emit(600, approvalRequest("send_confirmation", (c) => STEPS[3].approval!(c).summary)),
        emit(200, state("running", "waiting_approval", "approval required")),
        {
          kind: "gate",
          step: "send_confirmation",
          onApprove: [
            ...afterApproval("send_confirmation", "gmail.send", `Send “Meeting confirmation” to ${RAHIM.email}`, {
              started: "provider_confirmation",
              passed: "read_back",
            }),
            // Final verification: every step verified, no pending external action
            emit(500, state("running", "verifying", "final verification")),
            emit(900, {
              type: "TASK_COMPLETED",
              payload: () => ({ from: "verifying", to: "completed", reason: "all steps verified" }),
            }),
          ],
          onReject: afterRejection("send_confirmation", []),
        },
      ],
      onReject: afterRejection("create_meeting", ["send_confirmation"]),
    },
  ],
};

function schedulingScenarioPlanSummary(): string {
  return schedulingScenario.planSummary;
}

/** Build the StepOut rows the task detail would show once the plan is persisted. */
export function planSteps(scenario: Scenario, stepId: (key: ScenarioStepKey) => string): StepOut[] {
  return scenario.steps.map((s, position) => ({
    id: stepId(s.key),
    step_key: s.key,
    position,
    action: s.action,
    tool_name: s.tool_name,
    tool_version: s.tool_version,
    permission_level: s.permission_level,
    risk_level: s.risk_level,
    requires_approval: s.requires_approval,
    policy_reasons: s.policy_reasons,
    verification_method: s.verification_method,
    verification_status: "pending",
    status: "pending",
    plan_version: 1,
    attempt_count: 0,
    approval_request_id: null,
    started_at: null,
    completed_at: null,
    error_class: null,
    error_message: null,
    external_ref: null,
    output_summary: null,
    output_trust: null,
  }));
}
