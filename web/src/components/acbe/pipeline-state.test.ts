import { describe, expect, it } from "vitest";
import { candidateActions, candidatePipeline, pipelineOverview } from "./pipeline-state";

const base = { failure_type: "verification_lag", approved_at: null, promoted_at: null };

describe("candidatePipeline", () => {
  it("maps each backend status to the stage it is at", () => {
    const cases: Array<[string, string, Record<string, string>]> = [
      [
        "draft",
        "candidate",
        {
          failure: "done",
          analysis: "done",
          candidate: "active",
          evaluation: "pending",
          canary: "pending",
          promotion: "pending",
        },
      ],
      ["evaluating", "evaluation", { candidate: "done", evaluation: "active", canary: "pending" }],
      ["passed", "canary", { evaluation: "done", canary: "waiting", promotion: "pending" }],
      ["rejected", "evaluation", { candidate: "done", evaluation: "failed", canary: "skipped", promotion: "skipped" }],
      ["canary", "canary", { evaluation: "done", canary: "active", promotion: "pending" }],
      ["promoted", "promotion", { canary: "done", promotion: "done" }],
      ["retired", "promotion", { promotion: "done" }],
    ];
    for (const [status, current, stages] of cases) {
      const p = candidatePipeline({
        ...base,
        status,
        approved_at: status === "canary" || status === "promoted" ? "2026-09-01T00:00:00Z" : null,
      });
      expect(p.current, status).toBe(current);
      expect(p.stages, status).toMatchObject(stages);
      expect(p.rolledBack).toBe(false);
    }
  });

  it("flags stages where a person must act", () => {
    expect(candidatePipeline({ ...base, status: "passed" }).needsHuman).toBe(true);
    expect(candidatePipeline({ ...base, status: "canary", approved_at: "x" }).needsHuman).toBe(true);
    expect(candidatePipeline({ ...base, status: "evaluating" }).needsHuman).toBe(false);
    expect(candidatePipeline({ ...base, status: "promoted" }).needsHuman).toBe(false);
  });

  it("places a rollback at the stage it happened, using approval/promotion timestamps", () => {
    const afterPromotion = candidatePipeline({ ...base, status: "rolled_back", approved_at: "a", promoted_at: "b" });
    expect(afterPromotion).toMatchObject({ rolledBack: true, rolledBackFrom: "promotion", current: "promotion" });
    expect(afterPromotion.stages).toMatchObject({ canary: "done", promotion: "rolled_back" });

    const duringCanary = candidatePipeline({ ...base, status: "rolled_back", approved_at: "a" });
    expect(duringCanary).toMatchObject({ rolledBackFrom: "canary" });
    expect(duringCanary.stages).toMatchObject({ evaluation: "done", canary: "rolled_back", promotion: "skipped" });

    const beforeRollout = candidatePipeline({ ...base, status: "rolled_back" });
    expect(beforeRollout).toMatchObject({ rolledBackFrom: "evaluation" });
    expect(beforeRollout.stages).toMatchObject({ evaluation: "rolled_back", canary: "skipped" });
  });

  it("marks failure analysis as skipped for candidates produced by an experiment", () => {
    const p = candidatePipeline({ ...base, failure_type: "experiment", status: "passed" });
    expect(p.stages).toMatchObject({
      failure: "skipped",
      analysis: "skipped",
      candidate: "done",
      evaluation: "done",
      canary: "waiting",
    });
  });

  it("degrades gracefully for an unknown status", () => {
    expect(candidatePipeline({ ...base, status: "mystery" }).current).toBe("candidate");
  });
});

describe("candidateActions mirror backend preconditions", () => {
  it.each([
    ["draft", { evaluate: true, canary: false, promote: false, rollback: false }],
    ["evaluating", { evaluate: true, canary: false, promote: false, rollback: false }],
    ["passed", { evaluate: false, canary: true, promote: false, rollback: true }],
    ["canary", { evaluate: false, canary: true, promote: true, rollback: true }],
    ["promoted", { evaluate: false, canary: false, promote: false, rollback: true }],
    ["rejected", { evaluate: false, canary: false, promote: false, rollback: false }],
    ["rolled_back", { evaluate: false, canary: false, promote: false, rollback: false }],
    ["retired", { evaluate: false, canary: false, promote: false, rollback: false }],
  ])("%s", (status, expected) => {
    expect(candidateActions(status)).toEqual(expected);
  });
});

describe("pipelineOverview", () => {
  it("counts patterns and candidates per stage", () => {
    const failures = [
      { significant: true, learnable: true, occurrences: 5 },
      { significant: true, learnable: false, occurrences: 2 },
      { significant: false, learnable: true, occurrences: 1 },
    ];
    const statuses = [
      "draft",
      "evaluating",
      "passed",
      "passed",
      "rejected",
      "canary",
      "promoted",
      "rolled_back",
      "retired",
    ];
    const counts = Object.fromEntries(
      pipelineOverview(
        failures,
        statuses.map((status) => ({ status })),
      ).map((c) => [c.stage, c]),
    );
    expect(counts.failure).toMatchObject({ count: 3, detail: "8 verified failures", tone: "danger" });
    expect(counts.analysis).toMatchObject({ count: 1, detail: "2 not actionable" });
    expect(counts.candidate.count).toBe(1);
    expect(counts.evaluation).toMatchObject({ count: 1, detail: "1 rejected" });
    expect(counts.canary).toMatchObject({ count: 3, detail: "2 awaiting approval", tone: "warning" });
    expect(counts.promotion).toMatchObject({ count: 1, detail: "1 retired" });
    expect(counts.rollback.count).toBe(1);
  });
  it("is all zeros and neutral when nothing happened yet", () => {
    const counts = pipelineOverview([], []);
    expect(counts.every((c) => c.count === 0 && c.tone === "neutral")).toBe(true);
  });
});
