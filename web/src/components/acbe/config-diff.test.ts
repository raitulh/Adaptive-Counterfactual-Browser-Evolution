import { describe, expect, it } from "vitest";
import { diffStrategy, formatValue, mergeStrategy } from "./config-diff";

describe("mergeStrategy mirrors StrategyConfig.merged", () => {
  it("appends planner hints (deduped, max 10) and merges per-tool maps", () => {
    const base = {
      planner_hints: ["a", "b"],
      tool_retry: { "gmail.send": { max_attempts: 2, base_delay_seconds: 2 } },
      verification_readback: { "calendar.create_event": { attempts: 3, delay_ms: 500 } },
      browser_locator_order: ["role", "css"],
      memory_weights: { semantic: 0.45, keyword: 0.25, recency: 0.1, importance: 0.2 },
    };
    const patch = {
      planner_hints: ["b", "c"],
      verification_readback: { "calendar.create_event": { attempts: 6, delay_ms: 900 } },
      browser_locator_order: [],
      memory_weights: null,
    };
    expect(mergeStrategy(base, patch)).toEqual({
      planner_hints: ["a", "b", "c"],
      tool_retry: { "gmail.send": { max_attempts: 2, base_delay_seconds: 2 } },
      verification_readback: { "calendar.create_event": { attempts: 6, delay_ms: 900 } },
      browser_locator_order: ["role", "css"],
      memory_weights: base.memory_weights,
    });
  });
  it("replaces locator order and memory weights when the patch sets them", () => {
    const merged = mergeStrategy(
      { browser_locator_order: ["css"] },
      { browser_locator_order: ["role", "label"], memory_weights: { semantic: 1 } },
    );
    expect(merged.browser_locator_order).toEqual(["role", "label"]);
    expect(merged.memory_weights).toEqual({ semantic: 1 });
  });
  it("caps planner hints at ten", () => {
    const hints = Array.from({ length: 12 }, (_, i) => `h${i}`);
    expect(
      (mergeStrategy({ planner_hints: hints.slice(0, 8) }, { planner_hints: hints.slice(8) }).planner_hints as string[])
        .length,
    ).toBe(10);
  });
});

describe("diffStrategy", () => {
  it("reports leaf-level additions, changes and removals with paths that keep tool names intact", () => {
    const before = {
      verification_readback: { "calendar.create_event": { attempts: 3, delay_ms: 500 } },
      planner_hints: [],
      tool_retry: {},
    };
    const after = {
      verification_readback: { "calendar.create_event": { attempts: 6, delay_ms: 500 } },
      planner_hints: ["confirm the recipient"],
      tool_retry: {},
      memory_weights: null,
    };
    expect(diffStrategy(before, after)).toEqual([
      { path: ["planner_hints"], kind: "added", before: null, after: ["confirm the recipient"] },
      { path: ["verification_readback", "calendar.create_event", "attempts"], kind: "changed", before: 3, after: 6 },
    ]);
  });
  it("treats empty containers and null as the same (no noise)", () => {
    expect(
      diffStrategy({ tool_retry: {}, planner_hints: [], memory_weights: null }, { tool_retry: {}, planner_hints: [] }),
    ).toEqual([]);
  });
  it("reports whole new tool entries as added objects", () => {
    const rows = diffStrategy({ tool_retry: {} }, { tool_retry: { "gmail.send": { max_attempts: 4 } } });
    expect(rows).toEqual([
      { path: ["tool_retry", "gmail.send"], kind: "added", before: null, after: { max_attempts: 4 } },
    ]);
  });
  it("detects removals and order-sensitive array changes", () => {
    expect(
      diffStrategy({ browser_locator_order: ["role", "css"] }, { browser_locator_order: ["css", "role"] })[0].kind,
    ).toBe("changed");
    expect(diffStrategy({ planner_hints: ["x"] }, { planner_hints: [] })[0]).toMatchObject({
      kind: "removed",
      before: ["x"],
    });
  });
  it("formats values for display", () => {
    expect(formatValue(null)).toBe("—");
    expect(formatValue("x")).toBe("x");
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
  });
});
