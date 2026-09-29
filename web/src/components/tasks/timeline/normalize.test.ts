import { describe, expect, it } from "vitest";
import type { TaskEvent } from "@/lib/api";
import { MEETING_EVENTS, MEETING_STEP_IDS as S, MEETING_STEPS, meetingEventsUntil } from "./fixtures";
import { buildTimeline, currentActivity, groupByPhase, normalizeTimeline } from "./normalize";

let n = 0;
const ev = (
  type: string,
  payload: Record<string, unknown> = {},
  stepId: string | null = null,
  actor = "system",
): TaskEvent => ({
  seq: ++n,
  event_type: type,
  step_id: stepId,
  actor_type: actor,
  payload,
  created_at: new Date(Date.UTC(2026, 8, 29, 5, 0, n)).toISOString(),
});

describe("normalizeTimeline — completed meeting task", () => {
  const entries = normalizeTimeline(MEETING_EVENTS, { steps: MEETING_STEPS, taskStatus: "completed" });

  it("merges tool call start/finish into one entry with duration and result", () => {
    const calls = entries.filter((e) => e.kind === "tool_call");
    expect(calls).toHaveLength(4);
    const slot = calls[0];
    expect(slot.title).toBe("Calendar · Find free slots");
    expect(slot.tool).toBe("calendar.find_free_slots");
    expect(slot.stepLabel).toBe("Find a free 30-minute slot tomorrow after 2 PM");
    expect(slot.durationMs).toBe(365);
    expect(slot.state).toBe("done");
    expect(slot.detail).toBe("Found 5 free 30-minute slot(s) on 2026-09-30");
    expect(slot.events.map((e) => e.event_type)).toEqual(["TOOL_CALL_STARTED", "TOOL_CALL_FINISHED"]);
  });

  it("merges verification start/pass and the STEP_COMPLETED it produces", () => {
    const verifications = entries.filter((e) => e.kind === "verification");
    expect(verifications).toHaveLength(4);
    const meeting = verifications.find((v) => v.stepId === S.create_meeting)!;
    expect(meeting.title).toBe("Verified: Schedule the meeting with Rahim");
    expect(meeting.tone).toBe("verify");
    expect(meeting.methodLabel).toBe("Read back from the provider");
    expect(meeting.events.map((e) => e.event_type)).toEqual([
      "VERIFICATION_STARTED",
      "VERIFICATION_PASSED",
      "STEP_COMPLETED",
    ]);
    // No separate "completed" rows once verification covered them.
    expect(entries.some((e) => e.kind === "step")).toBe(false);
  });

  it("builds human planning sentences and hides implied status changes", () => {
    const titles = entries.filter((e) => e.phase === "planning").map((e) => e.title);
    expect(titles).toEqual([
      "Goal received",
      "Understanding the goal and drafting a plan",
      "Plan created · 4 steps",
      "Plan validated · 4 steps",
    ]);
    expect(entries.find((e) => e.title === "Plan validated · 4 steps")?.detail).toMatch(
      /2 actions will need your approval/,
    );
    expect(entries.some((e) => e.minor)).toBe(false);
    expect(entries.filter((e) => e.title === "Execution started")).toHaveLength(1);
  });

  it("resolves approvals once granted", () => {
    const approvals = entries.filter((e) => e.kind === "approval");
    expect(approvals.map((a) => [a.title, a.state])).toEqual([
      ["Approval requested: Create calendar event “Meeting with Rahim”", "done"],
      ["Approved", "done"],
      ["Approval requested: Send e-mail “Meeting confirmation” to rahim@example.org", "done"],
      ["Approved", "done"],
    ]);
    expect(approvals[0].riskLevel).toBe("high");
  });

  it("ends with a verified completion and nothing left in progress", () => {
    expect(entries.at(-1)).toMatchObject({
      phase: "outcome",
      tone: "success",
      title: "Completed — every action verified",
    });
    expect(entries.some((e) => e.state === "active" || e.state === "waiting")).toBe(false);
  });

  it("groups consecutive entries into phases that read as a story", () => {
    const groups = groupByPhase(entries);
    expect(groups.map((g) => g.label)).toEqual([
      "Planning",
      "Execution",
      "Verification",
      "Approval",
      "Execution",
      "Verification",
      "Approval",
      "Execution",
      "Verification",
      "Result",
    ]);
  });

  it("includes bookkeeping events only with showAll", () => {
    const all = normalizeTimeline(MEETING_EVENTS, { steps: MEETING_STEPS, showAll: true });
    expect(all.filter((e) => e.minor).length).toBeGreaterThan(5);
    expect(all.length).toBeGreaterThan(entries.length);
  });
});

describe("normalizeTimeline — live states", () => {
  it("shows the running tool call as active while the task runs", () => {
    const { current } = buildTimeline(meetingEventsUntil(11), { steps: MEETING_STEPS, taskStatus: "running" });
    expect(current).toMatchObject({ kind: "tool_call", state: "active", tool: "contacts.lookup" });
  });

  it("shows a pending approval as waiting", () => {
    const { entries, current } = buildTimeline(meetingEventsUntil(21), {
      steps: MEETING_STEPS,
      taskStatus: "waiting_approval",
    });
    expect(current).toMatchObject({ kind: "approval", state: "waiting", approvalId: "ap-1" });
    expect(entries.find((e) => e.approvalId === "ap-1")?.title).toBe(
      "Waiting for your approval: Create calendar event “Meeting with Rahim”",
    );
  });

  it("never leaves entries pulsing once no worker drives the task", () => {
    const entries = normalizeTimeline(meetingEventsUntil(10), { steps: MEETING_STEPS, taskStatus: "failed" });
    expect(entries.some((e) => e.state === "active")).toBe(false);
  });

  it("marks planning active until a plan exists", () => {
    const planning = normalizeTimeline(meetingEventsUntil(3), { taskStatus: "planning" });
    expect(currentActivity(planning)?.title).toBe("Understanding the goal and drafting a plan");
    const planned = normalizeTimeline(meetingEventsUntil(5), { taskStatus: "planned" });
    expect(planned.find((e) => e.title.startsWith("Understanding"))?.state).toBe("done");
  });
});

describe("normalizeTimeline — failure, recovery and input", () => {
  it("folds a retry decision with its schedule and reports the failed call", () => {
    n = 0;
    const events = [
      ev("TOOL_CALL_STARTED", { step: "find_slot", tool: "calendar.find_free_slots", attempt: 1 }, "s1"),
      ev(
        "TOOL_CALL_FINISHED",
        {
          step: "find_slot",
          tool: "calendar.find_free_slots",
          error: "integration_temporarily_unavailable",
          error_class: "transient",
        },
        "s1",
      ),
      ev(
        "RECOVERY_DECIDED",
        { step: "find_slot", decision: "retry", reason: "transient; retrying with backoff", error_class: "transient" },
        "s1",
      ),
      ev("RETRY_SCHEDULED", { step: "find_slot", delay_seconds: 1.61 }, "s1"),
      ev("TOOL_CALL_STARTED", { step: "find_slot", tool: "calendar.find_free_slots", attempt: 2 }, "s1"),
      ev(
        "TOOL_CALL_FINISHED",
        {
          step: "find_slot",
          tool: "calendar.find_free_slots",
          error: "integration_temporarily_unavailable",
          error_class: "transient",
        },
        "s1",
      ),
      ev(
        "RECOVERY_DECIDED",
        { step: "find_slot", decision: "fail", reason: "retries exhausted", error_class: "transient" },
        "s1",
      ),
      ev(
        "STEP_FAILED",
        {
          step: "find_slot",
          error: "integration_temporarily_unavailable",
          message: "Google Calendar is temporarily unavailable.",
        },
        "s1",
      ),
      ev("TASK_FAILED", { from: "running", to: "failed", reason: "integration_temporarily_unavailable" }),
    ];
    const entries = normalizeTimeline(events, {
      steps: [{ id: "s1", step_key: "find_slot", action: "Find a free slot", tool_name: "calendar.find_free_slots" }],
      taskStatus: "failed",
    });
    const [call1, retry, call2, stop, failed, outcome] = entries;
    expect(call1).toMatchObject({
      kind: "tool_call",
      state: "failed",
      tone: "danger",
      detail: "The provider is temporarily unavailable",
    });
    expect(retry).toMatchObject({
      kind: "recovery",
      title: "Retrying: Find a free slot",
      detail: "Temporary problem at the provider · next attempt in 1.6s",
    });
    expect(retry.events).toHaveLength(2);
    expect(call2.attempt).toBe(2);
    expect(stop).toMatchObject({ title: "Stopped trying: Find a free slot", state: "failed" });
    expect(failed).toMatchObject({
      title: "Step failed: Find a free slot",
      detail: "Google Calendar is temporarily unavailable.",
    });
    expect(outcome).toMatchObject({
      phase: "outcome",
      title: "The task did not complete",
      detail: "The provider is temporarily unavailable",
    });
  });

  it("asks for input and resolves it when answered", () => {
    n = 0;
    const events = [
      ev(
        "RECOVERY_DECIDED",
        {
          step: "find_contact",
          decision: "request_user",
          reason: "I couldn't find an e-mail address for “Zoe”. What is it?",
        },
        "c1",
      ),
      ev("TASK_STATE_CHANGED", { from: "running", to: "waiting_input", reason: "waiting for user input" }),
      ev("INPUT_REQUIRED", { questions: ["I couldn't find an e-mail address for “Zoe”. What is it?"] }),
    ];
    const waiting = normalizeTimeline(events, { taskStatus: "waiting_input" });
    expect(currentActivity(waiting)).toMatchObject({
      kind: "input",
      state: "waiting",
      bullets: ["I couldn't find an e-mail address for “Zoe”. What is it?"],
    });

    const answered = normalizeTimeline(
      [
        ...events,
        ev("INPUT_RECEIVED", { question: "I couldn't find an e-mail address for “Zoe”. What is it?" }, null, "user"),
        ev("STEP_COMPLETED", { step: "find_contact", summary: "Using zoe@example.com", source: "user" }, "c1"),
      ],
      { taskStatus: "queued" },
    );
    expect(answered.find((e) => e.kind === "input" && e.title === "Asked for your input")?.state).toBe("done");
    expect(answered.at(-1)).toMatchObject({
      kind: "step",
      title: "Completed with your answer: Find contact",
      detail: "Using zoe@example.com",
    });
  });

  it("describes blocked steps, reconciliation and verification mismatches", () => {
    n = 0;
    const events = [
      ev(
        "RECOVERY_DECIDED",
        {
          step: "find_slot",
          decision: "block",
          reason: "the connected account must be reconnected",
          error_class: "auth_expired",
        },
        "s1",
      ),
      ev("TASK_STATE_CHANGED", { from: "running", to: "blocked", reason: "blocked; user action required" }),
      ev("TASK_STATE_CHANGED", { from: "blocked", to: "queued", reason: "resumed by user" }, null, "user"),
      ev("TASK_RESUMED", {}, null, "user"),
      ev("VERIFICATION_STARTED", { step: "create", method: "read_back" }, "s2"),
      ev(
        "VERIFICATION_FAILED",
        { step: "create", method: "read_back", status: "failed", differences: ["start", "end"] },
        "s2",
      ),
      ev("RECONCILIATION_REQUIRED", { step: "create", outcome: "unknown" }, "s2"),
      ev("RECONCILIATION_RESOLVED", { step: "create", outcome: "succeeded" }, "s2", "user"),
    ];
    const entries = normalizeTimeline(events, { taskStatus: "queued" });
    expect(entries[0]).toMatchObject({
      title: "Blocked: Find slot",
      detail: "The connected account must be reconnected",
      tone: "danger",
    });
    expect(entries[1]).toMatchObject({ title: "Blocked until you take action", state: "done" }); // resolved by the resume
    expect(entries[2]).toMatchObject({ title: "Resumed by you" });
    expect(entries[3]).toMatchObject({
      kind: "verification",
      state: "failed",
      title: "Verification failed: Create",
      bullets: ["Differs in: Start, End"],
    });
    expect(entries[4]).toMatchObject({ title: "Couldn't confirm whether “Create” happened", state: "done" });
    expect(entries[5]).toMatchObject({ title: "You confirmed “Create” happened", tone: "success" });
  });

  it("renders unknown event types as generic rows instead of dropping them", () => {
    n = 0;
    const entries = normalizeTimeline([
      ev("SOMETHING_NEW", { a: 1 }),
      ev("PLAN_REJECTED", { issues: [{ code: "x", message: "Tool not allowed" }] }),
    ]);
    expect(entries[0]).toMatchObject({ kind: "generic", title: "Something new" });
    expect(entries[1]).toMatchObject({
      title: "Plan rejected by safety checks",
      bullets: ["Tool not allowed"],
      state: "failed",
    });
  });

  it("handles an unfinished tool call finishing without a start (external worker)", () => {
    n = 0;
    const entries = normalizeTimeline([
      ev("TOOL_CALL_FINISHED", { step: "b", summary: "Page captured", error_class: null }, "b1"),
    ]);
    expect(entries[0]).toMatchObject({ kind: "tool_call", state: "done", detail: "Page captured" });
  });
});

describe("readable", () => {
  it("replaces ISO date-times inside text and leaves the rest untouched", async () => {
    const { readable } = await import("./readable");
    const out = readable("Create event from 2026-09-30T16:00:00+00:00 to 2026-09-30T16:30:00Z with ref 2026-x");
    expect(out).not.toMatch(/T16:00/);
    expect(out).toMatch(/^Create event from .+2026.+ to .+ with ref 2026-x$/);
    expect(readable(null)).toBeNull();
    expect(readable("no dates")).toBe("no dates");
  });
});

describe("normalizeTimeline — direct answers", () => {
  it("never claims verification for a plan without actions", () => {
    n = 0;
    const entries = normalizeTimeline([
      ev("PLAN_CREATED", { plan_version: 1, steps: 0, summary: "Answer directly." }),
      ev("TASK_COMPLETED", { from: "verifying", to: "completed", reason: "all steps verified" }),
    ]);
    expect(entries[0].title).toBe("Plan created · no actions needed");
    expect(entries[1]).toMatchObject({
      title: "Completed — answered directly, no actions taken",
      detail: "The answer was not externally verified.",
    });
  });
});
