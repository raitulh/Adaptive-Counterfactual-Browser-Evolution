import { describe, expect, it } from "vitest";
import type { EvaluationRunOut } from "@/lib/api";
import { experimentActions, experimentStages, pendingVariants } from "./experiment-state";

const variants = [{ name: "control" }, { name: "longer-readback" }];

describe("experimentActions", () => {
  it("offers only actions the backend accepts in each status", () => {
    expect(experimentActions({ status: "draft", winner_variant: null, variants })).toEqual({
      start: true,
      decide: false,
      canary: false,
      promote: false,
      rollback: false,
    });
    expect(experimentActions({ status: "running", winner_variant: null, variants })).toMatchObject({
      start: false,
      decide: true,
      canary: false,
    });
    expect(experimentActions({ status: "evaluated", winner_variant: "longer-readback", variants })).toMatchObject({
      decide: true,
      canary: true,
      promote: false,
      rollback: true,
    });
    expect(experimentActions({ status: "canary", winner_variant: "longer-readback", variants })).toMatchObject({
      decide: false,
      canary: true,
      promote: true,
      rollback: true,
    });
    expect(experimentActions({ status: "promoted", winner_variant: "longer-readback", variants })).toMatchObject({
      canary: false,
      promote: false,
      rollback: true,
    });
    expect(experimentActions({ status: "rejected", winner_variant: null, variants })).toMatchObject({
      decide: true,
      canary: false,
      rollback: false,
    });
  });
  it("never offers a rollout when the control 'won'", () => {
    expect(experimentActions({ status: "evaluated", winner_variant: "control", variants }).canary).toBe(false);
  });
});

describe("pendingVariants", () => {
  const run = (variant: string, status: string): EvaluationRunOut => ({ variant, status }) as EvaluationRunOut;
  it("uses the latest run per variant", () => {
    expect(pendingVariants({ variants }, [])).toEqual(["control", "longer-readback"]);
    expect(pendingVariants({ variants }, [run("control", "completed"), run("longer-readback", "running")])).toEqual([
      "longer-readback",
    ]);
    expect(
      pendingVariants({ variants }, [
        run("control", "completed"),
        run("longer-readback", "failed"),
        run("longer-readback", "completed"),
      ]),
    ).toEqual([]);
  });
});

describe("experimentStages", () => {
  it("marks progress, rejection and rollback", () => {
    expect(experimentStages({ status: "running", approved_at: null }).map((s) => s.state)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(experimentStages({ status: "rejected", approved_at: null }).map((s) => s.state)).toEqual([
      "done",
      "done",
      "failed",
      "skipped",
      "skipped",
    ]);
    expect(experimentStages({ status: "promoted", approved_at: "x" }).every((s) => s.state === "done")).toBe(true);
    expect(experimentStages({ status: "rolled_back", approved_at: "x" }).map((s) => s.state)).toEqual([
      "done",
      "done",
      "done",
      "failed",
      "skipped",
    ]);
    expect(experimentStages({ status: "rolled_back", approved_at: null }).map((s) => s.state)).toEqual([
      "done",
      "done",
      "failed",
      "skipped",
      "skipped",
    ]);
  });
});
