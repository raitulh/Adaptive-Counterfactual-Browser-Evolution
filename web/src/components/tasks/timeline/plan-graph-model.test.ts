import { describe, expect, it } from "vitest";
import { MEETING_PLAN, MEETING_STEPS } from "./fixtures";
import { buildPlanGraph, extractStepRefs } from "./plan-graph-model";

describe("extractStepRefs", () => {
  it("finds $ref objects and {{…}} templates at any depth", () => {
    const refs = extractStepRefs({
      a: { $ref: "steps.find_slot.output.slots.0.start" },
      list: [{ $ref: "steps.find_contact.output.best.email" }],
      body: "Confirmed for {{ steps.create_meeting.output.start }} and {{steps.other.output}}",
      notARef: { $ref: "not a ref" },
      mixed: { $ref: "steps.x.output", extra: 1 }, // not a pure reference object → walked, no ref
    });
    expect([...refs].sort()).toEqual(["create_meeting", "find_contact", "find_slot", "other"]);
  });
});

describe("buildPlanGraph", () => {
  it("lays out the meeting plan with a parallel first level", () => {
    const g = buildPlanGraph({ plan: MEETING_PLAN, steps: MEETING_STEPS, planVersion: 1 });
    expect(g.levels.map((l) => l.map((n) => n.key))).toEqual([["find_slot", "find_contact"], ["create_meeting"], ["send_confirmation"]]);
    expect(g.parallel).toBe(true);
    expect(g.dependenciesKnown).toBe(true);
    expect(g.nodes.find((n) => n.key === "send_confirmation")?.dependsOn.sort()).toEqual(["create_meeting", "find_contact"]);
    expect(g.edges).toContainEqual({ from: "find_slot", to: "create_meeting" });
    expect(g.nodes[2]).toMatchObject({ status: "completed", verification: "passed", requiresApproval: true, riskLevel: "high" });
  });

  it("derives dependencies from data references even when none are declared", () => {
    const plan = {
      steps: [
        { step_id: "a", action: "A", tool: "t.a", arguments: {} },
        { step_id: "b", action: "B", tool: "t.b", arguments: { x: { $ref: "steps.a.output.id" } } },
        { step_id: "c", action: "C", tool: "t.c", arguments: { note: "see {{steps.b.output.url}}" } },
        { step_id: "d", action: "D", tool: "t.d", arguments: {} },
      ],
    };
    const g = buildPlanGraph({ plan, steps: [] });
    expect(g.levels.map((l) => l.map((n) => n.key))).toEqual([["a", "d"], ["b"], ["c"]]);
    expect(g.nodes.every((n) => n.status === null)).toBe(true);
  });

  it("ignores superseded plan versions and unknown dependencies, and survives cycles", () => {
    const plan = {
      steps: [
        { step_id: "a", action: "A", tool: "t", dependencies: ["b", "ghost"] },
        { step_id: "b", action: "B", tool: "t", dependencies: ["a"] },
      ],
    };
    const steps = [
      { ...MEETING_STEPS[0], step_key: "a", plan_version: 2 },
      { ...MEETING_STEPS[1], step_key: "old", plan_version: 1 },
    ];
    const g = buildPlanGraph({ plan, steps, planVersion: 2 });
    expect(g.nodes.map((n) => n.key)).toEqual(["a", "b"]);
    expect(g.nodes[0].dependsOn).toEqual(["b"]);
    expect(g.levels.flat()).toHaveLength(2);
  });

  it("falls back to the recorded order when no plan is stored", () => {
    const g = buildPlanGraph({ plan: null, steps: MEETING_STEPS });
    expect(g.dependenciesKnown).toBe(false);
    expect(g.levels.map((l) => l.length)).toEqual([1, 1, 1, 1]);
    expect(g.parallel).toBe(false);
  });

  it("recognizes a direct answer plan", () => {
    const g = buildPlanGraph({ plan: { goal: "Q", summary: "Answer directly.", steps: [], direct_response: "**A**" }, steps: [] });
    expect(g.directResponse).toBe(true);
    expect(g.levels).toEqual([]);
  });
});
