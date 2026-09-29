import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { schedulingScenario } from "./scheduling-scenario";
import {
  ApprovalNotPendingError,
  derivePhase,
  SimulatedTaskEventSource,
  type TaskRunSnapshot,
} from "./task-event-source";

const START = new Date("2026-09-29T09:00:00Z").getTime();

function types(s: TaskRunSnapshot) {
  return s.events.map((e) => e.event_type);
}

describe("SimulatedTaskEventSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts idle and emits nothing before start()", () => {
    const src = new SimulatedTaskEventSource();
    expect(src.getSnapshot().events).toHaveLength(0);
    expect(derivePhase(src.getSnapshot())).toBe("idle");
    vi.advanceTimersByTime(60_000);
    expect(src.getSnapshot().events).toHaveLength(0);
  });

  it("emits contiguous, ordered events on a timed schedule and halts at the first approval", () => {
    const src = new SimulatedTaskEventSource();
    const seen: number[] = [];
    src.subscribe((e) => e && seen.push(e.seq));
    src.start();

    // The first event is scheduled after its beat delay, not synchronously.
    expect(src.getSnapshot().events).toHaveLength(0);
    vi.advanceTimersByTime(349);
    expect(src.getSnapshot().events).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(types(src.getSnapshot())).toEqual(["TASK_CREATED"]);

    vi.advanceTimersByTime(60_000);
    const snap = src.getSnapshot();
    expect(seen).toEqual(snap.events.map((_, i) => i + 1));
    expect(snap.events.map((e) => e.seq)).toEqual(seen);
    expect(snap.events).toHaveLength(21);
    expect(types(snap).slice(0, 9)).toEqual([
      "TASK_CREATED",
      "TASK_STATE_CHANGED",
      "PLANNING_STARTED",
      "TASK_STATE_CHANGED",
      "PLAN_CREATED",
      "TASK_STATE_CHANGED",
      "PLAN_VALIDATED",
      "TASK_STATE_CHANGED",
      "TASK_STATE_CHANGED",
    ]);
    expect(snap.events.at(-2)?.event_type).toBe("APPROVAL_REQUIRED");
    expect(snap.task.status).toBe("waiting_approval");
    expect(snap.pendingApproval?.tool_name).toBe("calendar.create_event");
    expect(derivePhase(snap)).toBe("approval");

    // Nothing has been written before the approval.
    const writes = snap.events.filter(
      (e) => e.event_type === "TOOL_CALL_STARTED" && (e.payload as { tool?: string }).tool === "calendar.create_event",
    );
    expect(writes).toHaveLength(0);
    // Timestamps follow the injected clock.
    expect(Date.parse(snap.events[0].created_at)).toBe(START + 350);
    for (let i = 1; i < snap.events.length; i++) {
      expect(Date.parse(snap.events[i].created_at)).toBeGreaterThanOrEqual(Date.parse(snap.events[i - 1].created_at));
    }
  });

  it("gates each side effect on its own approval and completes only after final verification", async () => {
    const src = new SimulatedTaskEventSource();
    src.start();
    vi.advanceTimersByTime(60_000);

    const first = src.getSnapshot().pendingApproval!;
    await expect(src.approve("not-the-pending-approval")).rejects.toBeInstanceOf(ApprovalNotPendingError);
    await src.approve(first.id);
    // A replayed decision on the same approval is refused (single use).
    await expect(src.approve(first.id)).rejects.toBeInstanceOf(ApprovalNotPendingError);

    vi.advanceTimersByTime(60_000);
    let snap = src.getSnapshot();
    expect(snap.pendingApproval?.tool_name).toBe("gmail.send");
    expect(snap.pendingApproval?.id).not.toBe(first.id);
    expect(snap.task.status).toBe("waiting_approval");
    const meeting = snap.steps.find((s) => s.step_key === "create_meeting")!;
    expect(meeting.status).toBe("completed");
    expect(meeting.verification_status).toBe("passed");
    expect(snap.events.filter((e) => (e.payload as { tool?: string }).tool === "gmail.send")).toHaveLength(0);

    await src.approve(snap.pendingApproval!.id);
    vi.advanceTimersByTime(60_000);
    snap = src.getSnapshot();

    expect(snap.events).toHaveLength(41);
    expect(snap.events.map((e) => e.seq)).toEqual(Array.from({ length: 41 }, (_, i) => i + 1));
    expect(types(snap).slice(-2)).toEqual(["TASK_STATE_CHANGED", "TASK_COMPLETED"]);
    expect(snap.events.at(-2)?.payload).toMatchObject({ from: "running", to: "verifying" });
    expect(snap.task.status).toBe("completed");
    expect(snap.finished).toBe(true);
    expect(snap.steps.every((s) => s.status === "completed" && s.verification_status === "passed")).toBe(true);
    expect(snap.approvals.map((a) => a.status)).toEqual(["approved", "approved"]);
    const grants = snap.events.filter((e) => e.event_type === "APPROVAL_GRANTED");
    expect(grants.every((e) => e.actor_type === "user")).toBe(true);
    expect(derivePhase(snap)).toBe("completed");
  });

  it("rejecting an approval fails the task honestly: the write never runs and dependants are skipped", async () => {
    const src = new SimulatedTaskEventSource();
    src.start();
    vi.advanceTimersByTime(60_000);
    await src.reject(src.getSnapshot().pendingApproval!.id);
    vi.advanceTimersByTime(60_000);

    const snap = src.getSnapshot();
    expect(snap.task.status).toBe("failed");
    expect(snap.finished).toBe(true);
    expect(snap.events.some((e) => e.event_type === "APPROVAL_REJECTED")).toBe(true);
    expect(snap.events.some((e) => (e.payload as { tool?: string }).tool === "calendar.create_event")).toBe(false);
    const byKey = Object.fromEntries(snap.steps.map((s) => [s.step_key, s.status]));
    expect(byKey).toMatchObject({ create_meeting: "failed", send_confirmation: "skipped" });
    expect(derivePhase(snap)).toBe("failed");
    // No further events arrive once finished.
    const n = snap.events.length;
    vi.advanceTimersByTime(120_000);
    expect(src.getSnapshot().events).toHaveLength(n);
  });

  it("honours the speed multiplier and supports reset", () => {
    const src = new SimulatedTaskEventSource({ speed: 2 });
    src.start();
    vi.advanceTimersByTime(175);
    expect(src.getSnapshot().events).toHaveLength(1);
    const listener = vi.fn();
    src.subscribe(listener);
    src.reset();
    expect(listener).toHaveBeenCalledWith(null, expect.objectContaining({ events: [] }));
    vi.advanceTimersByTime(60_000);
    expect(src.getSnapshot().events).toHaveLength(0);
    src.start();
    vi.advanceTimersByTime(175);
    expect(src.getSnapshot().events).toHaveLength(1);
  });

  it("uses an injected clock for deterministic playback", () => {
    let now = 1_000;
    const timers: Array<{ at: number; fn: () => void }> = [];
    const clock = {
      now: () => now,
      setTimeout: (fn: () => void, ms: number) => {
        const t = { at: now + ms, fn };
        timers.push(t);
        return t;
      },
      clearTimeout: (h: unknown) => {
        const i = timers.indexOf(h as (typeof timers)[number]);
        if (i >= 0) timers.splice(i, 1);
      },
    };
    const src = new SimulatedTaskEventSource({ clock });
    src.start();
    for (let i = 0; i < 5; i++) {
      const t = timers.shift()!;
      now = t.at;
      t.fn();
    }
    const snap = src.getSnapshot();
    expect(snap.events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(snap.events[0].created_at).toBe(new Date(1_350).toISOString());
    expect(snap.task.plan_version).toBe(1);
    expect(snap.steps.map((s) => s.step_key)).toEqual(schedulingScenario.steps.map((s) => s.key));
    src.dispose();
    expect(timers).toHaveLength(0);
  });
});
