import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLICY,
  aggregateScore,
  classifySignal,
  decide,
  makeSignal,
  riskFromScore,
} from "@/lib/verification/scoring";
import { SIGNALS } from "@/lib/verification/signals";

const all = (scores: [number, number, number, number]) =>
  SIGNALS.map((definition, index) => makeSignal(definition.id, scores[index]!));

describe("signal catalog", () => {
  it("has weights that sum to 1", () => {
    const total = SIGNALS.reduce((sum, signal) => sum + signal.weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});

describe("classifySignal", () => {
  it.each([
    [0.9, "pass"],
    [0.75, "pass"],
    [0.74, "review"],
    [0.5, "review"],
    [0.49, "fail"],
  ] as const)("classifies %s as %s", (score, status) => {
    expect(classifySignal(score)).toBe(status);
  });
});

describe("aggregateScore", () => {
  it("computes the weighted mean", () => {
    expect(aggregateScore(all([0.96, 0.94, 0.92, 0.9]))).toBe(0.93);
  });

  it("ignores pending signals", () => {
    const signals = [
      ...all([0.9, 0.9, 0.9, 0.9]).slice(0, 2),
      { ...makeSignal("session_consistency", 0.1), status: "pending" as const },
    ];
    expect(aggregateScore(signals)).toBe(0.9);
  });

  it("returns 0 with no resolved signals", () => {
    expect(aggregateScore([])).toBe(0);
  });
});

describe("decide", () => {
  it("allows high aggregate scores", () => {
    expect(decide(all([0.96, 0.94, 0.92, 0.9]))).toEqual({
      decision: "allow",
      score: 0.93,
      risk: "low",
    });
  });

  it("steps up ambiguous sessions", () => {
    expect(decide(all([0.58, 0.82, 0.77, 0.52]))).toMatchObject({
      decision: "step_up",
      risk: "medium",
    });
  });

  it("denies low scores", () => {
    expect(decide(all([0.2, 0.3, 0.4, 0.3]))).toMatchObject({ decision: "deny", risk: "high" });
  });

  it("never lets a single failing signal deny on its own — only downgrade to step-up", () => {
    const result = decide(all([0.99, 0.99, 0.99, 0.4]));
    expect(result.score).toBeGreaterThanOrEqual(DEFAULT_POLICY.allowAt);
    expect(result.decision).toBe("step_up");
    expect(result.risk).toBe("medium");
  });

  it("respects custom policies", () => {
    expect(decide(all([0.7, 0.7, 0.7, 0.7]), { allowAt: 0.65, stepUpAt: 0.4 }).decision).toBe(
      "allow",
    );
  });
});

describe("riskFromScore", () => {
  it("maps thresholds to risk levels", () => {
    expect(riskFromScore(0.8)).toBe("low");
    expect(riskFromScore(0.6)).toBe("medium");
    expect(riskFromScore(0.2)).toBe("high");
  });
});
