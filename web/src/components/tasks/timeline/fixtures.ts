/**
 * Realistic task data recorded from the simulated backend ("Schedule a meeting with Rahim…").
 * Used by unit tests, and usable by demos that render the pure timeline components with mock data.
 */
import type { StepOut, TaskEvent } from "@/lib/api";

const T0 = Date.parse("2026-09-29T05:00:42.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

export const MEETING_STEP_IDS = {
  find_slot: "01a0eb89-5b1e-768d-bcab-7b38522d6303",
  find_contact: "01a0eb89-5b1e-7946-ae22-01318c258892",
  create_meeting: "01a0eb89-5b1e-73fe-a28c-4337d6ee131f",
  send_confirmation: "01a0eb89-5b1e-7990-bd8e-716002d2c4bc",
} as const;

const S = MEETING_STEP_IDS;
let seq = 0;
function ev(
  type: string,
  payload: Record<string, unknown> = {},
  stepId: string | null = null,
  actor = "system",
  ms?: number,
): TaskEvent {
  seq += 1;
  return { seq, event_type: type, step_id: stepId, actor_type: actor, payload, created_at: at(ms ?? seq * 120) };
}

export const MEETING_PLAN: Record<string, unknown> = {
  goal: "Schedule a meeting with Rahim tomorrow after 2 PM and email him a confirmation",
  summary: "Find a free 30-minute slot tomorrow after 2 PM, invite Rahim, then e-mail a confirmation.",
  steps: [
    {
      step_id: "find_slot",
      action: "Find a free 30-minute slot tomorrow after 2 PM",
      tool: "calendar.find_free_slots",
      arguments: { date: "tomorrow", duration_minutes: 30 },
      dependencies: [],
    },
    {
      step_id: "find_contact",
      action: "Look up Rahim's e-mail address",
      tool: "contacts.lookup",
      arguments: { name: "Rahim" },
      dependencies: [],
    },
    {
      step_id: "create_meeting",
      action: "Schedule the meeting with Rahim",
      tool: "calendar.create_event",
      arguments: {
        summary: "Meeting with Rahim",
        start: { $ref: "steps.find_slot.output.slots.0.start" },
        end: { $ref: "steps.find_slot.output.slots.0.end" },
        attendees: [{ $ref: "steps.find_contact.output.best.email" }],
      },
      dependencies: ["find_slot", "find_contact"],
      requires_approval: true,
      risk_level: "medium",
    },
    {
      step_id: "send_confirmation",
      action: "E-mail Rahim a confirmation",
      tool: "gmail.send",
      arguments: {
        to: [{ $ref: "steps.find_contact.output.best.email" }],
        subject: "Meeting confirmation",
        body: "Hi Rahim,\n\nOur meeting is confirmed for {{steps.create_meeting.output.start}}.",
      },
      dependencies: ["create_meeting", "find_contact"],
      requires_approval: true,
      risk_level: "high",
    },
  ],
  dependencies: {
    find_slot: [],
    find_contact: [],
    create_meeting: ["find_slot", "find_contact"],
    send_confirmation: ["create_meeting", "find_contact"],
  },
  direct_response: null,
};

function step(
  key: keyof typeof S,
  position: number,
  action: string,
  tool: string,
  extra: Partial<StepOut> = {},
): StepOut {
  return {
    id: S[key],
    step_key: key,
    plan_version: 1,
    position,
    action,
    tool_name: tool,
    tool_version: "v1",
    status: "completed",
    permission_level: "read",
    risk_level: "low",
    requires_approval: false,
    policy_reasons: [],
    approval_request_id: null,
    verification_method: "output_schema",
    verification_status: "passed",
    attempt_count: 1,
    output_summary: null,
    output_trust: "controlled_agent_output",
    external_ref: null,
    error_class: null,
    error_message: null,
    started_at: at(position * 400),
    completed_at: at(position * 400 + 350),
    ...extra,
  };
}

export const MEETING_STEPS: StepOut[] = [
  step("find_slot", 0, "Find a free 30-minute slot tomorrow after 2 PM", "calendar.find_free_slots", {
    output_summary: "Found 5 free 30-minute slot(s) on 2026-09-30",
  }),
  step("find_contact", 1, "Look up Rahim's e-mail address", "contacts.lookup", {
    output_summary: "Resolved “Rahim” to rahim@example.org (google_contacts)",
  }),
  step("create_meeting", 2, "Schedule the meeting with Rahim", "calendar.create_event", {
    permission_level: "write",
    risk_level: "high",
    requires_approval: true,
    verification_method: "read_back",
    external_ref: "1c5qrfft0oaev71aqimdet6hip3sp60mquavvmvd5kdf59r7k7ug",
    output_summary: "Created calendar event “Meeting with Rahim” at 2026-09-30T15:00:00+00:00",
  }),
  step("send_confirmation", 3, "E-mail Rahim a confirmation", "gmail.send", {
    permission_level: "high_risk_write",
    risk_level: "high",
    requires_approval: true,
    verification_method: "read_back",
    external_ref: "sent6",
    output_summary: "Sent e-mail “Meeting confirmation” to rahim@example.org",
  }),
];

seq = 0;
export const MEETING_EVENTS: TaskEvent[] = [
  ev("TASK_CREATED", { source: "api" }, null, "user"),
  ev("TASK_STATE_CHANGED", { from: "created", to: "planning", reason: "planning started" }),
  ev("PLANNING_STARTED", { replan: false }),
  ev("TASK_STATE_CHANGED", { from: "planning", to: "planned", reason: "plan created" }),
  ev("PLAN_CREATED", {
    plan_version: 1,
    steps: 4,
    summary: "Find a free 30-minute slot tomorrow after 2 PM, invite Rahim, then e-mail a confirmation.",
  }),
  ev("TASK_STATE_CHANGED", { from: "planned", to: "validating", reason: "validating plan" }),
  ev("PLAN_VALIDATED", { plan_version: 1, approvals_expected: 2 }),
  ev("TASK_STATE_CHANGED", { from: "validating", to: "queued", reason: "plan validated" }),
  ev("TASK_STATE_CHANGED", { from: "queued", to: "running", reason: "execution started" }),
  ev(
    "TOOL_CALL_STARTED",
    { step: "find_slot", tool: "calendar.find_free_slots", attempt: 1, action: "Find free time slots" },
    S.find_slot,
  ),
  ev(
    "TOOL_CALL_STARTED",
    { step: "find_contact", tool: "contacts.lookup", attempt: 1, action: "Resolve a person's name" },
    S.find_contact,
  ),
  ev(
    "TOOL_CALL_FINISHED",
    {
      step: "find_slot",
      tool: "calendar.find_free_slots",
      summary: "Found 5 free 30-minute slot(s) on 2026-09-30",
      duration_ms: 365,
    },
    S.find_slot,
  ),
  ev(
    "TOOL_CALL_FINISHED",
    {
      step: "find_contact",
      tool: "contacts.lookup",
      summary: "Resolved “Rahim” to rahim@example.org (google_contacts)",
      duration_ms: 364,
    },
    S.find_contact,
  ),
  ev("VERIFICATION_STARTED", { step: "find_slot", method: "output_schema" }, S.find_slot),
  ev("VERIFICATION_STARTED", { step: "find_contact", method: "output_schema" }, S.find_contact),
  ev("VERIFICATION_PASSED", { step: "find_slot", method: "output_schema" }, S.find_slot),
  ev("STEP_COMPLETED", { step: "find_slot", summary: "Found 5 free 30-minute slot(s) on 2026-09-30" }, S.find_slot),
  ev("VERIFICATION_PASSED", { step: "find_contact", method: "output_schema" }, S.find_contact),
  ev(
    "STEP_COMPLETED",
    { step: "find_contact", summary: "Resolved “Rahim” to rahim@example.org (google_contacts)" },
    S.find_contact,
  ),
  ev(
    "APPROVAL_REQUIRED",
    {
      approval_id: "ap-1",
      summary: "Create calendar event “Meeting with Rahim”",
      risk_level: "high",
      expires_at: at(86_400_000),
    },
    S.create_meeting,
  ),
  ev("TASK_STATE_CHANGED", { from: "running", to: "waiting_approval", reason: "waiting for approval" }),
  ev("APPROVAL_GRANTED", { approval_id: "ap-1" }, S.create_meeting, "user"),
  ev("TASK_STATE_CHANGED", { from: "waiting_approval", to: "queued", reason: "approval granted" }, null, "user"),
  ev("TASK_STATE_CHANGED", { from: "queued", to: "running", reason: "execution started" }),
  ev("TOOL_CALL_STARTED", { step: "create_meeting", tool: "calendar.create_event", attempt: 1 }, S.create_meeting),
  ev(
    "TOOL_CALL_FINISHED",
    {
      step: "create_meeting",
      tool: "calendar.create_event",
      summary: "Created calendar event “Meeting with Rahim” at 2026-09-30T15:00:00+00:00",
      duration_ms: 357,
    },
    S.create_meeting,
  ),
  ev("VERIFICATION_STARTED", { step: "create_meeting", method: "read_back" }, S.create_meeting),
  ev("VERIFICATION_PASSED", { step: "create_meeting", method: "read_back" }, S.create_meeting),
  ev(
    "STEP_COMPLETED",
    { step: "create_meeting", summary: "Created calendar event “Meeting with Rahim”" },
    S.create_meeting,
  ),
  ev(
    "APPROVAL_REQUIRED",
    {
      approval_id: "ap-2",
      summary: "Send e-mail “Meeting confirmation” to rahim@example.org",
      risk_level: "high",
      expires_at: at(86_400_000),
    },
    S.send_confirmation,
  ),
  ev("TASK_STATE_CHANGED", { from: "running", to: "waiting_approval", reason: "waiting for approval" }),
  ev("APPROVAL_GRANTED", { approval_id: "ap-2" }, S.send_confirmation, "user"),
  ev("TASK_STATE_CHANGED", { from: "waiting_approval", to: "queued", reason: "approval granted" }, null, "user"),
  ev("TASK_STATE_CHANGED", { from: "queued", to: "running", reason: "execution started" }),
  ev("TOOL_CALL_STARTED", { step: "send_confirmation", tool: "gmail.send", attempt: 1 }, S.send_confirmation),
  ev(
    "TOOL_CALL_FINISHED",
    {
      step: "send_confirmation",
      tool: "gmail.send",
      summary: "Sent e-mail “Meeting confirmation” to rahim@example.org",
      duration_ms: 361,
    },
    S.send_confirmation,
  ),
  ev("VERIFICATION_STARTED", { step: "send_confirmation", method: "provider_confirmation" }, S.send_confirmation),
  ev("VERIFICATION_PASSED", { step: "send_confirmation", method: "read_back" }, S.send_confirmation),
  ev(
    "STEP_COMPLETED",
    { step: "send_confirmation", summary: "Sent e-mail “Meeting confirmation” to rahim@example.org" },
    S.send_confirmation,
  ),
  ev("TASK_STATE_CHANGED", { from: "running", to: "verifying", reason: "final verification" }),
  ev("TASK_COMPLETED", { from: "verifying", to: "completed", reason: "all steps verified" }),
];

/** The first N events of the meeting task (for "live" states). */
export function meetingEventsUntil(seqInclusive: number): TaskEvent[] {
  return MEETING_EVENTS.filter((e) => e.seq <= seqInclusive);
}
