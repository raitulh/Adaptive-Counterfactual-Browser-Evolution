import { describe, expect, it } from "vitest";
import { buildMeters, dailyKinds, dailySeries, formatMetric, meterFor, niceMax, otherTotals } from "./usage-math";

describe("meterFor", () => {
  it("computes ratio, clamped percent, remaining and state thresholds", () => {
    expect(meterFor("task_created", 50, 200)).toMatchObject({
      used: 50,
      limit: 200,
      percent: 25,
      ratio: 0.25,
      remaining: 150,
      state: "ok",
      tone: "accent",
    });
    expect(meterFor("task_created", 160, 200)).toMatchObject({ percent: 80, state: "near", tone: "warning" });
    expect(meterFor("task_created", 159, 200).state).toBe("ok");
    expect(meterFor("task_created", 200, 200)).toMatchObject({
      percent: 100,
      remaining: 0,
      state: "at_limit",
      tone: "danger",
    });
    expect(meterFor("task_created", 260, 200)).toMatchObject({
      percent: 100,
      ratio: 1.3,
      remaining: 0,
      state: "over",
      tone: "danger",
    });
  });

  it("treats a missing quota as unlimited (the backend doesn't cap it)", () => {
    expect(meterFor("model_call", 1234, undefined)).toMatchObject({
      limit: null,
      percent: null,
      remaining: null,
      state: "unlimited",
    });
    expect(meterFor("model_call", 1, null).state).toBe("unlimited");
  });

  it("handles zero quotas and missing/negative usage", () => {
    expect(meterFor("search_query", 0, 0)).toMatchObject({ state: "at_limit", remaining: 0 });
    expect(meterFor("search_query", 3, 0)).toMatchObject({ state: "over" });
    expect(meterFor("tool_call", undefined, 100)).toMatchObject({ used: 0, percent: 0, state: "ok" });
    expect(meterFor("tool_call", -5, 100)).toMatchObject({ used: 0, remaining: 100 });
  });
});

describe("buildMeters / otherTotals", () => {
  const quotas = {
    task_created: 200,
    model_call: 2000,
    tool_call: 5000,
    browser_seconds: 1800,
    search_query: 300,
    automation_run: 300,
  };
  it("builds one meter per plan quota in canonical order", () => {
    const meters = buildMeters({ task_created: 3, model_input_tokens: 900 }, quotas);
    expect(meters.map((m) => m.key)).toEqual([
      "task_created",
      "model_call",
      "tool_call",
      "browser_seconds",
      "search_query",
      "automation_run",
    ]);
    expect(meters[0]).toMatchObject({ used: 3, limit: 200 });
  });
  it("includes unknown quota keys after the known ones", () => {
    expect(
      buildMeters({}, { ...quotas, gpu_minutes: 10 })
        .map((m) => m.key)
        .at(-1),
    ).toBe("gpu_minutes");
  });
  it("shows known metrics as unlimited when the plan has no quotas at all", () => {
    const meters = buildMeters({ task_created: 5 }, {});
    expect(meters).toHaveLength(1);
    expect(meters[0].state).toBe("unlimited");
  });
  it("lists metered usage without a meter separately", () => {
    const meters = buildMeters({ task_created: 3, model_input_tokens: 900, storage_bytes: 2048 }, quotas);
    expect(
      otherTotals(
        { task_created: 3, model_input_tokens: 900, storage_bytes: 2048 },
        meters.map((m) => m.key),
      ).map(([k]) => k),
    ).toEqual(["model_input_tokens", "storage_bytes"]);
  });
});

describe("formatMetric", () => {
  it("formats by unit", () => {
    expect(formatMetric("browser_seconds", 1800)).toBe("30 min");
    expect(formatMetric("browser_seconds", 90)).toBe("1.5 min");
    expect(formatMetric("browser_seconds", 45)).toBe("45s");
    expect(formatMetric("browser_seconds", 36000)).toBe("10 h");
    expect(formatMetric("browser_seconds", 360000)).toBe("100 h");
    expect(formatMetric("storage_bytes", 2048)).toBe("2.0 KB");
    expect(formatMetric("task_created", 1234)).toBe("1,234");
    expect(formatMetric("task_created", 50000, { compact: true })).toBe("50K");
    expect(formatMetric("task_created", null)).toBe("—");
  });
});

describe("daily series", () => {
  const byDay = [
    { date: "2026-09-02", kind: "task_created", quantity: 4 },
    { date: "2026-09-02", kind: "task_created", quantity: 1 },
    { date: "2026-09-04", kind: "task_created", quantity: 2 },
    { date: "2026-09-04", kind: "tool_call", quantity: 30 },
  ];
  it("fills missing days with zero from the period start through today (UTC)", () => {
    const s = dailySeries(byDay, "task_created", "2026-09-01", new Date("2026-09-05T13:00:00Z"));
    expect(s).toEqual([
      { date: "2026-09-01", value: 0 },
      { date: "2026-09-02", value: 5 },
      { date: "2026-09-03", value: 0 },
      { date: "2026-09-04", value: 2 },
      { date: "2026-09-05", value: 0 },
    ]);
  });
  it("orders kinds by volume", () => {
    expect(dailyKinds(byDay)).toEqual(["tool_call", "task_created"]);
  });
  it("picks a clean axis maximum", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(4100)).toBe(5000);
  });
});
