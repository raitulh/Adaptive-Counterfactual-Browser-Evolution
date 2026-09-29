/**
 * End-to-end scenarios against the in-browser demo backend, through the REAL API layer
 * (tasksApi/approvalsApi/authFetch/session refresh) and the REAL SSE client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 20_000 });

vi.mock("@/lib/config/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/config/env")>();
  return { env: { ...mod.env, demoMode: true } };
});

import {
  approvalsApi,
  AgentOSApiError,
  memoryApi,
  newIdempotencyKey,
  notificationsApi,
  tasksApi,
  type TaskEvent,
  type UserStreamMessage,
} from "@/lib/api";
import { DEMO_GOALS } from "@/lib/demo/backend";
import { closeStreams, freshDemo, isSubsequence, listen, until } from "./demo-helpers";

beforeEach(() => freshDemo());
afterEach(() => closeStreams());

const eventTypes = (events: TaskEvent[]) => events.map((e) => e.event_type);

async function pendingApproval(taskId: string) {
  return until(async () => {
    const page = await approvalsApi.list({ task_id: taskId, status: "pending" });
    return page.items[0];
  });
}

async function waitForStatus(taskId: string, status: string) {
  await vi.waitFor(
    async () => {
      const t = await tasksApi.get(taskId);
      if (t.status !== status) throw new Error(`status ${t.status}`);
    },
    { timeout: 8000, interval: 10 },
  );
}

describe("meeting with Rahim: plan → 2 approvals → verified completion", () => {
  it("streams events in order, gates execution on approvals and completes with a verified summary", async () => {
    const user = listen("/events/stream");
    const task = await tasksApi.create({ goal: DEMO_GOALS.meeting }, newIdempotencyKey());
    expect(task.status).toBe("created");
    const stream = listen(`/tasks/${task.task_id}/events/stream`);

    const first = await pendingApproval(task.task_id);
    expect(first.tool_name).toBe("calendar.create_event");
    expect(first.summary).toMatch(/Meeting with Rahim.*rahim@example\.org/);
    expect(first.risk_level).toBe("high");
    expect(first.reasons).toEqual(
      expect.arrayContaining(["sends invitations to other people", "attendees outside the organization"]),
    );
    await waitForStatus(task.task_id, "waiting_approval");

    // Approval really gates execution: nothing past the gated step runs while waiting.
    let detail = await tasksApi.get(task.task_id);
    expect(detail.steps.map((s) => [s.step_key, s.status])).toEqual([
      ["find_slot", "completed"],
      ["find_contact", "completed"],
      ["create_meeting", "waiting_approval"],
      ["send_confirmation", "pending"],
    ]);
    await new Promise((r) => setTimeout(r, 60));
    expect((await tasksApi.get(task.task_id)).status).toBe("waiting_approval");

    await approvalsApi.approve(first.id, newIdempotencyKey(), "Looks right");
    const second = await until(async () => {
      const a = (await approvalsApi.list({ task_id: task.task_id, status: "pending" })).items[0];
      return a && a.id !== first.id ? a : undefined;
    });
    expect(second.tool_name).toBe("gmail.send");
    expect(second.permission_level).toBe("high_risk_write");
    await approvalsApi.approve(second.id, newIdempotencyKey());

    await waitForStatus(task.task_id, "completed");
    await until(() => stream.states.includes("ended"));

    // SSE framing: every task event has an id = seq, ends with `event: end`.
    const sse = stream.events.filter((e) => e.event !== "end");
    expect(sse.map((e) => Number(e.id))).toEqual(sse.map((_, i) => i + 1));
    expect(stream.types().at(-1)).toBe("end");
    expect(JSON.parse(stream.events.at(-1)!.data)).toEqual({ task_id: task.task_id, status: "completed" });

    const events = await tasksApi.eventsAfter(task.task_id);
    expect(sse.map((e) => e.event)).toEqual(eventTypes(events));
    expect(
      isSubsequence(
        [
          "TASK_CREATED",
          "PLANNING_STARTED",
          "PLAN_CREATED",
          "PLAN_VALIDATED",
          "TOOL_CALL_STARTED",
          "VERIFICATION_STARTED",
          "VERIFICATION_PASSED",
          "STEP_COMPLETED",
          "APPROVAL_REQUIRED",
          "APPROVAL_GRANTED",
          "TOOL_CALL_STARTED",
          "TOOL_CALL_FINISHED",
          "VERIFICATION_STARTED",
          "VERIFICATION_PASSED",
          "STEP_COMPLETED",
          "APPROVAL_REQUIRED",
          "APPROVAL_GRANTED",
          "TOOL_CALL_STARTED",
          "TOOL_CALL_FINISHED",
          "VERIFICATION_STARTED",
          "VERIFICATION_PASSED",
          "STEP_COMPLETED",
          "TASK_COMPLETED",
        ],
        eventTypes(events),
      ),
    ).toBe(true);
    const transitions = events
      .filter((e) => e.event_type === "TASK_STATE_CHANGED" || e.event_type === "TASK_COMPLETED")
      .map((e) => e.payload.to);
    expect(transitions).toEqual([
      "planning",
      "planned",
      "validating",
      "queued",
      "running",
      "waiting_approval",
      "queued",
      "running",
      "waiting_approval",
      "queued",
      "running",
      "verifying",
      "completed",
    ]);
    const granted = events.find((e) => e.event_type === "APPROVAL_GRANTED")!;
    expect(granted.actor_type).toBe("user");
    expect(granted.payload).toMatchObject({ approval_id: first.id });

    detail = await tasksApi.get(task.task_id);
    expect(detail.progress).toBe(1);
    expect(detail.steps.every((s) => s.status === "completed" && s.verification_status === "passed")).toBe(true);
    expect(detail.verifications.map((v) => `${v.scope}:${v.method}`)).toEqual(
      expect.arrayContaining(["step:read_back", "step:provider_confirmation", "task:state_comparison"]),
    );
    const summary = await tasksApi.summary(task.task_id);
    expect(summary.status).toBe("completed");
    expect(summary.headline).toMatch(
      /^Done: Created calendar event “Meeting with Rahim”.*; Sent e-mail “Meeting confirmation” to rahim@example\.org/,
    );
    expect(summary.what_changed.map((c) => c.tool)).toEqual(["calendar.create_event", "gmail.send"]);
    expect(summary.what_changed.every((c) => c.external_ref)).toBe(true);
    expect(summary.what_was_verified).toHaveLength(4);
    expect(summary.waiting_for_user).toEqual([]);
    expect(detail.result_summary).toMatchObject({ status: "completed", headline: summary.headline });

    // Approvals are consumed exactly once.
    const approved = await approvalsApi.get(first.id);
    expect(approved.status).toBe("approved");
    expect(approved.consumed_at).not.toBeNull();

    // The user stream carried task events and notifications with the documented shapes.
    await until(() => user.events.some((e) => e.event === "TASK_COMPLETED"));
    const messages = user.events.map((e) => JSON.parse(e.data) as UserStreamMessage);
    expect(messages).toContainEqual(
      expect.objectContaining({ type: "NOTIFICATION_CREATED", event: "approval_required", title: "Approval needed" }),
    );
    expect(messages).toContainEqual(expect.objectContaining({ type: "NOTIFICATION_CREATED", event: "task_completed" }));
    const completed = messages.find((m) => m.type === "TASK_COMPLETED");
    expect(completed).toEqual({
      type: "TASK_COMPLETED",
      task_id: task.task_id,
      seq: events.at(-1)!.seq,
      event_type: "TASK_COMPLETED",
      status: "completed",
      step_id: null,
    });
    expect(user.events.every((e) => e.id === null)).toBe(true);
  });
});

describe("unknown contact (Zoe) → waiting_input → answer → continues", () => {
  it("asks for the address instead of guessing, validates the answer and resumes the plan", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.unknownContact }, newIdempotencyKey());
    await waitForStatus(task.task_id, "waiting_input");
    const waiting = await tasksApi.get(task.task_id);
    expect(waiting.pending_questions).toEqual([
      "I couldn't find an e-mail address for “Zoe” in your contacts. What is their e-mail address?",
    ]);
    const summary = await tasksApi.summary(task.task_id);
    expect(summary.waiting_for_user).toEqual([{ type: "input", question: waiting.pending_questions![0] }]);
    expect(waiting.steps.find((s) => s.step_key === "find_contact")!.status).toBe("waiting_input");

    const bad = await tasksApi.provideInput(task.task_id, { answer: "not an address" }).catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(AgentOSApiError);
    expect((bad as AgentOSApiError).status).toBe(422);
    expect((bad as AgentOSApiError).details).toMatchObject({ field: "email" });

    const after = await tasksApi.provideInput(task.task_id, { answer: "zoe@example.com" });
    expect(after.status).toBe("queued");
    const approval = await pendingApproval(task.task_id);
    expect(approval.summary).toContain("zoe@example.com");
    await approvalsApi.approve(approval.id, newIdempotencyKey());
    const send = await until(async () =>
      (await approvalsApi.list({ task_id: task.task_id, status: "pending" })).items.find((a) => a.id !== approval.id),
    );
    await approvalsApi.approve(send.id, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");

    const events = await tasksApi.eventsAfter(task.task_id);
    expect(
      isSubsequence(
        [
          "TOOL_CALL_FINISHED",
          "RECOVERY_DECIDED",
          "INPUT_REQUIRED",
          "INPUT_RECEIVED",
          "STEP_COMPLETED",
          "TASK_COMPLETED",
        ],
        eventTypes(events),
      ),
    ).toBe(true);
    expect(events.find((e) => e.event_type === "RECOVERY_DECIDED")!.payload).toMatchObject({
      decision: "request_user",
      error_class: "needs_user_input",
    });
    expect(events.find((e) => e.event_type === "STEP_COMPLETED" && e.payload.source === "user")!.payload.summary).toBe(
      "Using zoe@example.com for “Zoe” (provided by you)",
    );
    const detail = await tasksApi.get(task.task_id);
    expect(detail.verifications.some((v) => v.method === "user_input")).toBe(true);
  });
});

describe("flaky calendar → retries → failure → resume works", () => {
  it("retries with backoff, fails honestly, and a resume completes the task", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.flaky }, newIdempotencyKey());
    const stream = listen(`/tasks/${task.task_id}/events/stream`);
    await waitForStatus(task.task_id, "failed");
    await until(() => stream.states.includes("ended"));
    expect(JSON.parse(stream.events.at(-1)!.data)).toMatchObject({ status: "failed" });

    const failed = await tasksApi.get(task.task_id);
    expect(failed.failure_code).toBe("integration_temporarily_unavailable");
    expect(failed.steps.map((s) => s.status)).toEqual(["failed", "completed", "skipped", "skipped"]);
    expect(failed.steps[0].attempt_count).toBe(3);
    const events = await tasksApi.eventsAfter(task.task_id);
    const types = eventTypes(events);
    expect(types.filter((t) => t === "RETRY_SCHEDULED")).toHaveLength(2);
    const decisions = events.filter((e) => e.event_type === "RECOVERY_DECIDED").map((e) => e.payload.decision);
    expect(decisions).toEqual(["retry", "retry", "fail"]);
    expect(events.find((e) => e.event_type === "RETRY_SCHEDULED")!.payload.delay_seconds).toBeGreaterThan(1);
    expect(
      isSubsequence(
        ["RETRY_SCHEDULED", "RETRY_SCHEDULED", "STEP_FAILED", "STEP_SKIPPED", "STEP_SKIPPED", "TASK_FAILED"],
        types,
      ),
    ).toBe(true);
    const summary = await tasksApi.summary(task.task_id);
    expect(summary.headline).toBe("The task did not complete: The external service is temporarily unavailable.");
    expect(summary.what_failed).toEqual([
      expect.objectContaining({ step: "find_slot", error_class: "transient", status: "failed" }),
    ]);

    const resumed = await tasksApi.resume(task.task_id);
    expect(resumed.status).toBe("queued");
    const approval = await pendingApproval(task.task_id);
    await approvalsApi.approve(approval.id, newIdempotencyKey());
    const send = await until(async () =>
      (await approvalsApi.list({ task_id: task.task_id, status: "pending" })).items.find((a) => a.id !== approval.id),
    );
    await approvalsApi.approve(send.id, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");
    const all = eventTypes(await tasksApi.eventsAfter(task.task_id));
    expect(
      isSubsequence(["TASK_FAILED", "TASK_RESUMED", "TOOL_CALL_STARTED", "STEP_COMPLETED", "TASK_COMPLETED"], all),
    ).toBe(true);
    expect((await tasksApi.get(task.task_id)).steps[0].attempt_count).toBe(4);
  });
});

describe("other scenarios", () => {
  it("rejecting an approval fails the step (policy_blocked) and the task", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.send }, newIdempotencyKey());
    const approval = await pendingApproval(task.task_id);
    expect(approval.reasons).toContain("organization requires approval for this tool");
    await approvalsApi.reject(approval.id, newIdempotencyKey(), "Wrong recipient");
    await waitForStatus(task.task_id, "failed");
    const detail = await tasksApi.get(task.task_id);
    expect(detail.failure_code).toBe("approval_rejected");
    expect(detail.steps[1]).toMatchObject({
      status: "failed",
      error_class: "policy_blocked",
      error_message: "Rejected by user: Wrong recipient",
    });
    expect((await approvalsApi.get(approval.id)).status).toBe("rejected");
  });

  it("drafts are writes verified by read-back and need no approval", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.draft }, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");
    const summary = await tasksApi.summary(task.task_id);
    expect(summary.what_changed).toEqual([
      expect.objectContaining({ tool: "gmail.create_draft", description: "Created draft “Quick follow-up”" }),
    ]);
    expect(summary.what_was_verified.map((v) => v.method)).toEqual(["output_schema", "read_back"]);
  });

  it("inbox scans are read-only; results are untrusted external content", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.inbox }, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");
    const detail = await tasksApi.get(task.task_id);
    expect(detail.steps[0]).toMatchObject({
      tool_name: "gmail.search",
      permission_level: "read",
      output_trust: "untrusted_external_content",
    });
    expect(detail.steps[0].output_summary).toMatch(/^Found \d+ e-mail\(s\)$/);
    expect((await tasksApi.summary(task.task_id)).headline).toBe("Done — every action was verified.");
  });

  it("'remember' saves a memory that shows up in the memory list", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.remember }, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");
    const memories = await memoryApi.list({ memory_type: "preference" });
    expect(memories.items[0]).toMatchObject({
      content: "I prefer 25-minute meetings on Fridays",
      source_type: "task",
      source_reference: `task:${task.task_id}`,
      freshness: "fresh",
    });
  });

  it("clarify: the planner asks first, then re-plans with the answer", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.clarify }, newIdempotencyKey());
    await waitForStatus(task.task_id, "waiting_input");
    expect((await tasksApi.get(task.task_id)).plan_version).toBe(0);
    const after = await tasksApi.provideInput(task.task_id, {
      answer: "Draft an email to Sara about Friday's launch review",
    });
    expect(after.status).toBe("planning");
    await waitForStatus(task.task_id, "completed");
    const detail = await tasksApi.get(task.task_id);
    expect(detail.plan_version).toBe(1);
    expect(detail.steps.map((s) => s.tool_name)).toEqual(["contacts.lookup", "gmail.create_draft"]);
  });

  it("direct answers complete without tools and are labelled as not externally verified", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.answer }, newIdempotencyKey());
    await waitForStatus(task.task_id, "completed");
    const summary = await tasksApi.summary(task.task_id);
    expect(summary.direct_response).toMatch(/Simulated answer/);
    expect(summary.direct_response_note).toBe(
      "Answered by the model without taking any action; not externally verified.",
    );
    expect(summary.what_happened).toEqual([]);
  });

  it("cancel while waiting for approval cancels steps and the pending approval", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.meeting }, newIdempotencyKey());
    const approval = await pendingApproval(task.task_id);
    const cancelled = await tasksApi.cancel(task.task_id);
    expect(cancelled.status).toBe("cancelled");
    expect((await approvalsApi.get(approval.id)).status).toBe("cancelled");
    const again = await tasksApi.cancel(task.task_id).catch((e: unknown) => e as AgentOSApiError);
    expect(again).toMatchObject({ status: 409, code: "task_terminal" });
    const approveLate = await approvalsApi
      .approve(approval.id, newIdempotencyKey())
      .catch((e: unknown) => e as AgentOSApiError);
    expect(approveLate).toMatchObject({ status: 409, code: "approval_not_pending" });
  });

  it("pause while waiting for approval, approve, then resume continues the run", async () => {
    const task = await tasksApi.create({ goal: DEMO_GOALS.send }, newIdempotencyKey());
    const approval = await pendingApproval(task.task_id);
    expect((await tasksApi.pause(task.task_id)).status).toBe("paused");
    await approvalsApi.approve(approval.id, newIdempotencyKey());
    await new Promise((r) => setTimeout(r, 50));
    expect((await tasksApi.get(task.task_id)).status).toBe("paused"); // approved, but paused: nothing runs
    await tasksApi.resume(task.task_id);
    await waitForStatus(task.task_id, "completed");
  });

  it("the seeded pending approval can be approved and completes its task", async () => {
    const pending = (await approvalsApi.list({ status: "pending" })).items;
    expect(pending).toHaveLength(1);
    const unreadBefore = (await notificationsApi.list({ unread_only: true })).items.length;
    await approvalsApi.approve(pending[0].id, newIdempotencyKey());
    await waitForStatus(pending[0].task_id, "completed");
    const unreadAfter = (await notificationsApi.list({ unread_only: true })).items.length;
    expect(unreadAfter).toBe(unreadBefore + 1); // "Task completed"
  });

  it("a disconnected Google account blocks the task; reconnect + resume completes it", async () => {
    const { integrationsApi } = await import("@/lib/api");
    const [google] = await integrationsApi.list();
    await integrationsApi.disconnect(google.id);
    const task = await tasksApi.create({ goal: DEMO_GOALS.draft }, newIdempotencyKey());
    await waitForStatus(task.task_id, "blocked");
    const blocked = await tasksApi.get(task.task_id);
    expect(blocked.failure_code).toBe("integration_not_connected");
    const connect = await integrationsApi.connectGoogle({ capabilities: ["gmail.compose", "contacts.read"] });
    expect(connect.authorization_url).toBe("/app/integrations?status=connected");
    await tasksApi.resume(task.task_id);
    await waitForStatus(task.task_id, "completed");
  });
});
