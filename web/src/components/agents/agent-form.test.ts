import { describe, expect, it } from "vitest";
import type { AgentVersionOut } from "@/lib/api";
import {
  agentConfigSchema,
  agentCreateSchema,
  configToFormValues,
  defaultCreateValues,
  formValuesToCreatePayload,
  formValuesToVersionPayload,
  mapBackendFieldErrors,
} from "./agent-form";
import { diffConfigs } from "./version-diff";

const version: AgentVersionOut = {
  id: "v-1",
  agent_id: "a-1",
  version_number: 3,
  checksum: "abc",
  created_at: "2026-09-01T10:00:00Z",
  instructions: "Schedule meetings politely.",
  model_policy: {
    planning_tier: "reasoning",
    default: "gemini-2.5-pro",
    fast: null,
    reasoning: null,
    fallbacks: ["gemini-2.5-flash"],
  },
  tool_policy: { allowed: ["calendar.*", "contacts.lookup"], denied: ["calendar.cancel_event"] },
  memory_policy: { enabled: false, max_items: 0, extract_after_task: false },
  execution_limits: {
    max_steps: 12,
    max_tool_calls: null,
    max_model_calls: null,
    max_duration_seconds: 600,
    max_cost_usd: 1.25,
    max_browser_actions: 0,
  },
  verification_policy: { readback_attempts: 5, readback_delay_ms: 1000 },
};

describe("agent form defaults", () => {
  it("start from the backend defaults (all tools allowed, memory on, 3 read-backs)", () => {
    const v = defaultCreateValues();
    expect(v.allowedTools).toEqual(["*"]);
    expect(v.deniedTools).toEqual([]);
    expect(v.memoryEnabled).toBe(true);
    expect(v.memoryMaxItems).toBe("8");
    expect(v.readbackAttempts).toBe("3");
    expect(v.readbackDelayMs).toBe("500");
    expect(v.maxSteps).toBe("");
    expect(agentCreateSchema.safeParse({ ...v, name: "Scheduler" }).success).toBe(true);
  });
});

describe("form → payload mapping", () => {
  it("round-trips a version without changing its configuration", () => {
    const payload = formValuesToVersionPayload(configToFormValues(version));
    expect(diffConfigs(version, payload).identical).toBe(true);
    expect(payload.execution_limits).toEqual({
      max_steps: 12,
      max_tool_calls: null,
      max_model_calls: null,
      max_duration_seconds: 600,
      max_cost_usd: 1.25,
      max_browser_actions: 0,
    });
  });

  it("maps empty strings to null and trims/dedupes lists", () => {
    const values = {
      ...configToFormValues(null),
      defaultModel: "  ",
      fastModel: " gemini-2.5-flash-lite ",
      fallbacks: ["a", "a", " b "],
      allowedTools: ["gmail.*", "gmail.*"],
      maxCostUsd: "",
      maxSteps: "25",
    };
    const p = formValuesToVersionPayload(agentConfigSchema.parse(values));
    expect(p.model_policy).toEqual({
      planning_tier: "default",
      default: null,
      fast: "gemini-2.5-flash-lite",
      reasoning: null,
      fallbacks: ["a", "b"],
    });
    expect(p.tool_policy).toEqual({ allowed: ["gmail.*"], denied: [] });
    expect(p.execution_limits?.max_steps).toBe(25);
    expect(p.execution_limits?.max_cost_usd).toBeNull();
  });

  it("create payload trims the name and nulls an empty description", () => {
    const p = formValuesToCreatePayload({ ...defaultCreateValues(), name: "  Inbox triage ", description: "" });
    expect(p.name).toBe("Inbox triage");
    expect(p.description).toBeNull();
    expect(p.tool_policy).toEqual({ allowed: ["*"], denied: [] });
  });
});

describe("validation mirrors backend constraints", () => {
  const base = defaultCreateValues();
  const errorsFor = (patch: Record<string, unknown>) => {
    const r = agentCreateSchema.safeParse({ ...base, name: "A", ...patch });
    return r.success ? [] : r.error.issues.map((i) => i.path.join("."));
  };

  it("enforces numeric ranges", () => {
    expect(errorsFor({ maxSteps: "0" })).toEqual(["maxSteps"]);
    expect(errorsFor({ maxSteps: "101" })).toEqual(["maxSteps"]);
    expect(errorsFor({ maxSteps: "100" })).toEqual([]);
    expect(errorsFor({ maxDurationSeconds: "9" })).toEqual(["maxDurationSeconds"]);
    expect(errorsFor({ maxDurationSeconds: String(7 * 24 * 3600 + 1) })).toEqual(["maxDurationSeconds"]);
    expect(errorsFor({ memoryMaxItems: "51" })).toEqual(["memoryMaxItems"]);
    expect(errorsFor({ memoryMaxItems: "" })).toEqual(["memoryMaxItems"]);
    expect(errorsFor({ readbackAttempts: "0" })).toEqual(["readbackAttempts"]);
    expect(errorsFor({ readbackDelayMs: "30001" })).toEqual(["readbackDelayMs"]);
    expect(errorsFor({ maxCostUsd: "1000.01" })).toEqual(["maxCostUsd"]);
    expect(errorsFor({ maxCostUsd: "12.5" })).toEqual([]);
    expect(errorsFor({ maxSteps: "1.5" })).toEqual(["maxSteps"]);
  });

  it("enforces text lengths and list sizes", () => {
    expect(errorsFor({ name: "" })).toEqual(["name"]);
    expect(errorsFor({ name: "x".repeat(121) })).toEqual(["name"]);
    expect(errorsFor({ instructions: "x".repeat(20_001) })).toEqual(["instructions"]);
    expect(errorsFor({ defaultModel: "m".repeat(101) })).toEqual(["defaultModel"]);
    expect(errorsFor({ fallbacks: ["a", "b", "c", "d", "e", "f"] })).toEqual(["fallbacks"]);
    expect(errorsFor({ allowedTools: ["gmail send"] })).toEqual(["allowedTools.0"]);
  });
});

describe("mapBackendFieldErrors", () => {
  it("maps nested backend locations to form fields", () => {
    expect(
      mapBackendFieldErrors({
        "execution_limits.max_steps": "Input should be less than or equal to 100",
        "tool_policy.allowed.2": "String should have at most 128 characters",
        unknown_field: "ignored",
      }),
    ).toEqual([
      ["maxSteps", "Input should be less than or equal to 100"],
      ["allowedTools", "String should have at most 128 characters"],
    ]);
  });
});
