import { describe, expect, it } from "vitest";
import { createApiError } from "@/lib/api/errors";
import { demoReducer, initialDemoState, type DemoState } from "@/lib/demo/machine";
import type { VerificationResult, VerificationSession } from "@/lib/schemas/verification";
import { makeSignal } from "@/lib/verification/scoring";

const session: VerificationSession = {
  id: "sess_test",
  status: "challenged",
  challenge: { type: "press_hold", ttlSeconds: 30 },
  createdAt: "2026-09-24T12:00:00.000Z",
  expiresAt: "2026-09-24T12:00:30.000Z",
};

const result = (decision: VerificationResult["decision"]): VerificationResult => ({
  sessionId: session.id,
  verified: decision === "allow",
  decision,
  risk: decision === "allow" ? "low" : "medium",
  score: decision === "allow" ? 0.93 : 0.68,
  token: decision === "allow" ? "rh_vt_demo_token" : null,
  signals: [makeSignal("interaction_pattern", 0.9)],
  decidedAt: "2026-09-24T12:00:05.000Z",
});

function toChallenge(): DemoState {
  let state = demoReducer(initialDemoState, { type: "START", runId: 1, at: 0 });
  state = demoReducer(state, { type: "SESSION_READY", runId: 1, session, at: 100 });
  return state;
}

describe("demoReducer", () => {
  it("walks the happy path idle → starting → challenge → analyzing → verified", () => {
    let state = demoReducer(initialDemoState, { type: "START", runId: 1, at: 0 });
    expect(state.status).toBe("starting");
    state = demoReducer(state, { type: "SESSION_READY", runId: 1, session, at: 400 });
    expect(state.status).toBe("challenge");
    state = demoReducer(state, {
      type: "CHALLENGE_SUBMITTED",
      runId: 1,
      inputMethod: "pointer",
      at: 1500,
    });
    expect(state.status).toBe("analyzing");
    state = demoReducer(state, {
      type: "SIGNAL",
      runId: 1,
      signal: makeSignal("interaction_pattern", 0.96),
      at: 1900,
    });
    expect(state.signals).toHaveLength(1);
    state = demoReducer(state, { type: "RESULT", runId: 1, result: result("allow"), at: 2600 });
    expect(state.status).toBe("verified");
    expect(state.log.map((entry) => entry.event)).toEqual([
      "session.create",
      "session.created",
      "challenge.completed",
      "signal.interaction_pattern",
      "decision.allow",
    ]);
    expect(state.log.at(-1)?.offsetMs).toBe(2600);
  });

  it("ignores events from a stale run", () => {
    const state = toChallenge();
    const next = demoReducer(state, {
      type: "CHALLENGE_SUBMITTED",
      runId: 99,
      inputMethod: "pointer",
      at: 1,
    });
    expect(next).toBe(state);
  });

  it("invalidates in-flight events after RESET", () => {
    const reset = demoReducer(toChallenge(), { type: "RESET" });
    expect(reset).toEqual(initialDemoState);
    expect(demoReducer(reset, { type: "SESSION_READY", runId: 1, session, at: 1 })).toBe(reset);
  });

  it("routes step_up decisions to a retryable state that reissues the challenge", () => {
    let state = demoReducer(toChallenge(), {
      type: "CHALLENGE_SUBMITTED",
      runId: 1,
      inputMethod: "keyboard",
      at: 1,
    });
    state = demoReducer(state, { type: "RESULT", runId: 1, result: result("step_up"), at: 2 });
    expect(state.status).toBe("step_up");
    state = demoReducer(state, { type: "RETRY_CHALLENGE", at: 3 });
    expect(state.status).toBe("challenge");
    expect(state.attempt).toBe(1);
    expect(state.signals).toEqual([]);
  });

  it("maps deny to blocked", () => {
    let state = demoReducer(toChallenge(), {
      type: "CHALLENGE_SUBMITTED",
      runId: 1,
      inputMethod: "pointer",
      at: 1,
    });
    state = demoReducer(state, { type: "RESULT", runId: 1, result: result("deny"), at: 2 });
    expect(state.status).toBe("blocked");
  });

  it("treats SESSION_EXPIRED failures as a timeout", () => {
    let state = demoReducer(toChallenge(), {
      type: "CHALLENGE_SUBMITTED",
      runId: 1,
      inputMethod: "pointer",
      at: 1,
    });
    state = demoReducer(state, {
      type: "FAILED",
      runId: 1,
      error: createApiError("SESSION_EXPIRED").error,
      at: 2,
    });
    expect(state.status).toBe("timeout");
  });

  it("expires an unanswered challenge on countdown", () => {
    const state = demoReducer(toChallenge(), {
      type: "EXPIRED",
      runId: 1,
      reason: "countdown",
      at: 30_000,
    });
    expect(state.status).toBe("timeout");
  });

  it("keeps network failures retryable", () => {
    let state = demoReducer(toChallenge(), {
      type: "CHALLENGE_SUBMITTED",
      runId: 1,
      inputMethod: "pointer",
      at: 1,
    });
    state = demoReducer(state, {
      type: "FAILED",
      runId: 1,
      error: createApiError("NETWORK_ERROR").error,
      at: 2,
    });
    expect(state.status).toBe("error");
    expect(state.error?.retryable).toBe(true);
    expect(demoReducer(state, { type: "RETRY_CHALLENGE", at: 3 }).status).toBe("challenge");
  });

  it("does not start a new run while one is in progress", () => {
    const state = toChallenge();
    expect(demoReducer(state, { type: "START", runId: 2, at: 5 })).toBe(state);
  });
});
