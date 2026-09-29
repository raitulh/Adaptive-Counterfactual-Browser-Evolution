import { describe, expect, it } from "vitest";
import { AgentOSApiError } from "@/lib/api/errors";
import { fingerprintOf, outcomeUnknown, SubmissionKeyTracker } from "./submission-key";

function tracker() {
  let i = 0;
  return new SubmissionKeyTracker(() => `key-${++i}`);
}

const network = new AgentOSApiError({ status: 0, code: "network_error", message: "Network request failed." });
const server = new AgentOSApiError({ status: 503, code: "unavailable", message: "down" });
const inProgress = new AgentOSApiError({ status: 409, code: "idempotency_conflict", message: "in progress" });
const invalid = new AgentOSApiError({ status: 422, code: "request_validation", message: "bad" });

describe("SubmissionKeyTracker", () => {
  it("reuses the key when the same submission is retried after a network error", () => {
    const t = tracker();
    const fp = fingerprintOf({ goal: "Plan my week" });
    expect(t.keyFor(fp)).toBe("key-1");
    t.failed(network);
    expect(t.keyFor(fp)).toBe("key-1");
    t.failed(server);
    expect(t.keyFor(fp)).toBe("key-1");
    t.failed(inProgress);
    expect(t.keyFor(fp)).toBe("key-1");
  });

  it("uses a new key after success", () => {
    const t = tracker();
    const fp = fingerprintOf({ goal: "Plan my week" });
    t.keyFor(fp);
    t.succeeded();
    expect(t.keyFor(fp)).toBe("key-2");
  });

  it("uses a new key when the submission is edited", () => {
    const t = tracker();
    t.keyFor(fingerprintOf({ goal: "Plan my week" }));
    t.failed(network);
    expect(t.keyFor(fingerprintOf({ goal: "Plan my week", priority: 10 }))).toBe("key-2");
  });

  it("uses a new key after a deterministic rejection (the backend stored that outcome)", () => {
    const t = tracker();
    const fp = fingerprintOf({ goal: "x" });
    t.keyFor(fp);
    t.failed(invalid);
    expect(t.keyFor(fp)).toBe("key-2");
  });
});

describe("outcomeUnknown / fingerprintOf", () => {
  it("classifies which failures leave the outcome unknown", () => {
    expect(outcomeUnknown(network)).toBe(true);
    expect(outcomeUnknown(new TypeError("Failed to fetch"))).toBe(true);
    expect(outcomeUnknown(server)).toBe(true);
    expect(outcomeUnknown(inProgress)).toBe(true);
    expect(outcomeUnknown(invalid)).toBe(false);
    expect(outcomeUnknown(new AgentOSApiError({ status: 409, code: "task_terminal", message: "" }))).toBe(false);
  });

  it("is stable across key order and ignores undefined fields", () => {
    expect(fingerprintOf({ b: 1, a: { d: 2, c: 3 }, z: undefined })).toBe(fingerprintOf({ a: { c: 3, d: 2 }, b: 1 }));
  });
});
