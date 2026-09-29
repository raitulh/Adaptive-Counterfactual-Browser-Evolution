import { describe, expect, it } from "vitest";
import type { AgentVersionIn } from "@/lib/api";
import { diffConfigs, diffLines, formatFieldValue, lineStats, normalizeConfig, toDisplayBlocks } from "./version-diff";

describe("diffLines", () => {
  it("returns only equal lines for identical text", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc");
    expect(ops.map((o) => o.type)).toEqual(["equal", "equal", "equal"]);
    expect(lineStats(ops)).toEqual({ added: 0, removed: 0 });
  });

  it("detects a changed line in the middle with line numbers on both sides", () => {
    const ops = diffLines("one\ntwo\nthree", "one\n2\nthree");
    expect(ops).toEqual([
      { type: "equal", text: "one", oldNo: 1, newNo: 1 },
      { type: "remove", text: "two", oldNo: 2 },
      { type: "add", text: "2", newNo: 2 },
      { type: "equal", text: "three", oldNo: 3, newNo: 3 },
    ]);
  });

  it("handles insertions and deletions at the edges", () => {
    expect(lineStats(diffLines("", "a\nb"))).toEqual({ added: 2, removed: 0 });
    expect(lineStats(diffLines("a\nb", ""))).toEqual({ added: 0, removed: 2 });
    const ops = diffLines("b\nc", "a\nb\nc\nd");
    expect(ops.map((o) => `${o.type}:${o.text}`)).toEqual(["add:a", "equal:b", "equal:c", "add:d"]);
  });

  it("finds the longest common subsequence across moved blocks", () => {
    const ops = diffLines("a\nb\nc\nd\ne", "a\nc\nd\nx\ne");
    expect(ops.filter((o) => o.type === "equal").map((o) => o.text)).toEqual(["a", "c", "d", "e"]);
    expect(lineStats(ops)).toEqual({ added: 1, removed: 1 });
  });

  it("normalizes Windows line endings", () => {
    expect(lineStats(diffLines("a\r\nb", "a\nb"))).toEqual({ added: 0, removed: 0 });
  });

  it("new-side line numbers stay consistent after the change", () => {
    const ops = diffLines("a\nb\nc", "a\nx\ny\nb\nc");
    const last = ops[ops.length - 1];
    expect(last).toEqual({ type: "equal", text: "c", oldNo: 3, newNo: 5 });
  });
});

describe("toDisplayBlocks", () => {
  it("collapses long unchanged runs but keeps context around changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
    const after = before.replace("line 10", "line ten");
    const blocks = toDisplayBlocks(diffLines(before, after), 2);
    expect(blocks.map((b) => b.kind)).toEqual(["collapsed", "lines", "collapsed"]);
    const shown = blocks[1].ops.map((o) => o.text);
    expect(shown).toEqual(["line 8", "line 9", "line 10", "line ten", "line 11", "line 12"]);
    expect(blocks[0].ops).toHaveLength(7);
  });

  it("does not collapse tiny unchanged gaps", () => {
    const blocks = toDisplayBlocks(diffLines("a\nb\nc\nd", "A\nb\nc\nD"), 0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe("lines");
  });
});

const base: AgentVersionIn = {
  instructions: "Be concise.",
  model_policy: { planning_tier: "default", default: null, fast: null, reasoning: null, fallbacks: ["a", "b"] },
  tool_policy: { allowed: ["gmail.*", "calendar.*"], denied: [] },
  memory_policy: { enabled: true, max_items: 8, extract_after_task: true },
  execution_limits: { max_steps: 20 },
  verification_policy: { readback_attempts: 3, readback_delay_ms: 500 },
};

describe("diffConfigs", () => {
  it("reports identical configurations", () => {
    const d = diffConfigs(base, structuredClone(base));
    expect(d.identical).toBe(true);
    expect(d.changeCount).toBe(0);
  });

  it("applies backend defaults so omitted fields equal their defaults", () => {
    const d = diffConfigs({ instructions: "x" }, {
      instructions: "x",
      tool_policy: { allowed: ["*"], denied: [] },
      memory_policy: { enabled: true, max_items: 8, extract_after_task: true },
      verification_policy: { readback_attempts: 3, readback_delay_ms: 500 },
    });
    expect(d.identical).toBe(true);
  });

  it("produces structured changes per section", () => {
    const next: AgentVersionIn = {
      ...structuredClone(base),
      instructions: "Be concise.\nAlways confirm times.",
      model_policy: { ...base.model_policy, planning_tier: "reasoning" },
      tool_policy: { allowed: ["gmail.*"], denied: ["gmail.send"] },
      execution_limits: { max_steps: null, max_cost_usd: 2.5 },
    };
    const d = diffConfigs(base, next);
    expect(d.instructionsChanged).toBe(true);
    expect(d.instructionStats).toEqual({ added: 1, removed: 0 });
    const tier = d.changedSections.find((s) => s.section === "model_policy")!.changes[0];
    expect(tier).toMatchObject({ kind: "scalar", field: "planning_tier", before: "default", after: "reasoning" });
    const tools = d.changedSections.find((s) => s.section === "tool_policy")!.changes;
    expect(tools).toEqual([
      expect.objectContaining({ field: "allowed", added: [], removed: ["calendar.*"] }),
      expect.objectContaining({ field: "denied", added: ["gmail.send"], removed: [] }),
    ]);
    const limits = d.changedSections.find((s) => s.section === "execution_limits")!.changes;
    expect(limits.map((c) => c.field).sort()).toEqual(["max_cost_usd", "max_steps"]);
    expect(d.changeCount).toBe(1 + 1 + 2 + 2);
  });

  it("treats fallback order as meaningful but tool pattern order as not", () => {
    const reordered: AgentVersionIn = {
      ...structuredClone(base),
      model_policy: { ...base.model_policy, fallbacks: ["b", "a"] },
      tool_policy: { allowed: ["calendar.*", "gmail.*"], denied: [] },
    };
    const d = diffConfigs(base, reordered);
    expect(d.changedSections.map((s) => s.section)).toEqual(["model_policy"]);
    expect(d.changedSections[0].changes[0]).toMatchObject({ kind: "list", reordered: true });
  });

  it("normalizes missing sections to backend defaults", () => {
    const n = normalizeConfig({});
    expect(n.tool_policy.allowed).toEqual(["*"]);
    expect(n.memory_policy.max_items).toBe(8);
    expect(n.model_policy.planning_tier).toBe("default");
  });
});

describe("formatFieldValue", () => {
  it("renders unset limits and model overrides readably", () => {
    expect(formatFieldValue("execution_limits", "max_steps", null)).toBe("No limit");
    expect(formatFieldValue("model_policy", "default", null)).toBe("Platform default");
    expect(formatFieldValue("execution_limits", "max_duration_seconds", 5400)).toBe("1 h 30 min");
    expect(formatFieldValue("execution_limits", "max_cost_usd", 2.5)).toBe("$2.50");
    expect(formatFieldValue("memory_policy", "enabled", false)).toBe("Off");
    expect(formatFieldValue("verification_policy", "readback_delay_ms", 500)).toBe("500 ms");
  });
});
