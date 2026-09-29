/**
 * Agent configuration form: zod schemas mirroring the backend constraints (app/agents/schemas.py)
 * and the exact mapping between form values and the API payloads (AgentCreate / AgentVersionIn).
 * Numeric inputs are kept as strings in the form so "empty" can mean "no limit".
 */
import { z } from "zod";
import type { AgentCreate, AgentVersionIn, AgentVersionOut } from "@/lib/api";
import { normalizeConfig } from "./version-diff";

export const PLANNING_TIERS = ["fast", "default", "reasoning"] as const;
export type PlanningTier = (typeof PLANNING_TIERS)[number];

/** Backend ranges (ge/le) for every numeric field. */
export const LIMITS = {
  instructions: 20_000,
  name: 120,
  description: 2_000,
  modelName: 100,
  fallbacks: 5,
  toolPatterns: 200,
  toolPatternLength: 128,
  memoryMaxItems: { min: 0, max: 50 },
  maxSteps: { min: 1, max: 100 },
  maxToolCalls: { min: 1, max: 1000 },
  maxModelCalls: { min: 1, max: 500 },
  maxDurationSeconds: { min: 10, max: 7 * 24 * 3600 },
  maxCostUsd: { min: 0, max: 1000 },
  maxBrowserActions: { min: 0, max: 1000 },
  readbackAttempts: { min: 1, max: 10 },
  readbackDelayMs: { min: 0, max: 30_000 },
} as const;

const INT = /^\d+$/;
const DECIMAL = /^\d+(\.\d{1,4})?$/;

function optionalInt(range: { min: number; max: number }) {
  return z
    .string()
    .trim()
    .refine((v) => v === "" || (INT.test(v) && Number(v) >= range.min && Number(v) <= range.max), {
      message: `Whole number from ${range.min} to ${range.max}, or empty for no limit`,
    });
}

function requiredInt(range: { min: number; max: number }) {
  return z
    .string()
    .trim()
    .refine((v) => INT.test(v) && Number(v) >= range.min && Number(v) <= range.max, {
      message: `Whole number from ${range.min} to ${range.max}`,
    });
}

const modelName = z.string().trim().max(LIMITS.modelName, `At most ${LIMITS.modelName} characters`);

export const toolPatternSchema = z
  .string()
  .trim()
  .min(1, "Enter a tool name or pattern")
  .max(LIMITS.toolPatternLength, `At most ${LIMITS.toolPatternLength} characters`)
  .regex(/^\S+$/, "Patterns cannot contain spaces");

const patternList = z.array(toolPatternSchema).max(LIMITS.toolPatterns, `At most ${LIMITS.toolPatterns} patterns`);

export const agentConfigSchema = z.object({
  instructions: z
    .string()
    .max(LIMITS.instructions, `At most ${LIMITS.instructions.toLocaleString("en-US")} characters`),
  planningTier: z.enum(PLANNING_TIERS),
  defaultModel: modelName,
  fastModel: modelName,
  reasoningModel: modelName,
  fallbacks: z
    .array(z.string().trim().min(1).max(LIMITS.modelName))
    .max(LIMITS.fallbacks, `At most ${LIMITS.fallbacks} fallback models`),
  allowedTools: patternList,
  deniedTools: patternList,
  memoryEnabled: z.boolean(),
  memoryMaxItems: requiredInt(LIMITS.memoryMaxItems),
  memoryExtractAfterTask: z.boolean(),
  maxSteps: optionalInt(LIMITS.maxSteps),
  maxToolCalls: optionalInt(LIMITS.maxToolCalls),
  maxModelCalls: optionalInt(LIMITS.maxModelCalls),
  maxDurationSeconds: optionalInt(LIMITS.maxDurationSeconds),
  maxCostUsd: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || (DECIMAL.test(v) && Number(v) >= LIMITS.maxCostUsd.min && Number(v) <= LIMITS.maxCostUsd.max),
      {
        message: "Amount from 0 to 1000 (up to 4 decimals), or empty for no limit",
      },
    ),
  maxBrowserActions: optionalInt(LIMITS.maxBrowserActions),
  readbackAttempts: requiredInt(LIMITS.readbackAttempts),
  readbackDelayMs: requiredInt(LIMITS.readbackDelayMs),
});

export type AgentConfigValues = z.infer<typeof agentConfigSchema>;

export const agentCreateSchema = agentConfigSchema.extend({
  name: z.string().trim().min(1, "Give the agent a name").max(LIMITS.name, `At most ${LIMITS.name} characters`),
  description: z.string().max(LIMITS.description, `At most ${LIMITS.description} characters`),
});

export type AgentCreateValues = z.infer<typeof agentCreateSchema>;

export const agentMetadataSchema = z.object({
  description: z.string().max(LIMITS.description, `At most ${LIMITS.description} characters`),
  status: z.enum(["active", "disabled"]),
});

export type AgentMetadataValues = z.infer<typeof agentMetadataSchema>;

// ------------------------------------------------------------------------------------ mapping

const str = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));
const intOrNull = (v: string) => (v.trim() === "" ? null : Number.parseInt(v.trim(), 10));
const floatOrNull = (v: string) => (v.trim() === "" ? null : Number(v.trim()));
const textOrNull = (v: string) => (v.trim() === "" ? null : v.trim());
const dedupe = (list: string[]) => [...new Set(list.map((s) => s.trim()).filter(Boolean))];

/** Form values for a version (or the backend defaults for a new agent). */
export function configToFormValues(version?: Partial<AgentVersionIn> | AgentVersionOut | null): AgentConfigValues {
  const c = normalizeConfig(version ?? null);
  return {
    instructions: c.instructions,
    planningTier: (PLANNING_TIERS as readonly string[]).includes(c.model_policy.planning_tier ?? "")
      ? (c.model_policy.planning_tier as PlanningTier)
      : "default",
    defaultModel: c.model_policy.default ?? "",
    fastModel: c.model_policy.fast ?? "",
    reasoningModel: c.model_policy.reasoning ?? "",
    fallbacks: [...c.model_policy.fallbacks],
    allowedTools: [...c.tool_policy.allowed],
    deniedTools: [...c.tool_policy.denied],
    memoryEnabled: c.memory_policy.enabled,
    memoryMaxItems: str(c.memory_policy.max_items),
    memoryExtractAfterTask: c.memory_policy.extract_after_task,
    maxSteps: str(c.execution_limits.max_steps),
    maxToolCalls: str(c.execution_limits.max_tool_calls),
    maxModelCalls: str(c.execution_limits.max_model_calls),
    maxDurationSeconds: str(c.execution_limits.max_duration_seconds),
    maxCostUsd: str(c.execution_limits.max_cost_usd),
    maxBrowserActions: str(c.execution_limits.max_browser_actions),
    readbackAttempts: str(c.verification_policy.readback_attempts),
    readbackDelayMs: str(c.verification_policy.readback_delay_ms),
  };
}

export function defaultCreateValues(): AgentCreateValues {
  return { name: "", description: "", ...configToFormValues(null) };
}

/** The complete, explicit version payload (every policy is sent, so the version is self-describing). */
export function formValuesToVersionPayload(v: AgentConfigValues): AgentVersionIn {
  return {
    instructions: v.instructions,
    model_policy: {
      planning_tier: v.planningTier,
      default: textOrNull(v.defaultModel),
      fast: textOrNull(v.fastModel),
      reasoning: textOrNull(v.reasoningModel),
      fallbacks: dedupe(v.fallbacks),
    },
    tool_policy: { allowed: dedupe(v.allowedTools), denied: dedupe(v.deniedTools) },
    memory_policy: {
      enabled: v.memoryEnabled,
      max_items: Number.parseInt(v.memoryMaxItems, 10),
      extract_after_task: v.memoryExtractAfterTask,
    },
    execution_limits: {
      max_steps: intOrNull(v.maxSteps),
      max_tool_calls: intOrNull(v.maxToolCalls),
      max_model_calls: intOrNull(v.maxModelCalls),
      max_duration_seconds: intOrNull(v.maxDurationSeconds),
      max_cost_usd: floatOrNull(v.maxCostUsd),
      max_browser_actions: intOrNull(v.maxBrowserActions),
    },
    verification_policy: {
      readback_attempts: Number.parseInt(v.readbackAttempts, 10),
      readback_delay_ms: Number.parseInt(v.readbackDelayMs, 10),
    },
  };
}

export function formValuesToCreatePayload(v: AgentCreateValues): AgentCreate {
  return {
    name: v.name.trim(),
    description: textOrNull(v.description),
    ...formValuesToVersionPayload(v),
  };
}

/** Backend 422 locations (`execution_limits.max_steps`) → form field names. */
const BACKEND_FIELD_MAP: Record<string, keyof AgentCreateValues> = {
  name: "name",
  description: "description",
  instructions: "instructions",
  "model_policy.planning_tier": "planningTier",
  "model_policy.default": "defaultModel",
  "model_policy.fast": "fastModel",
  "model_policy.reasoning": "reasoningModel",
  "model_policy.fallbacks": "fallbacks",
  "tool_policy.allowed": "allowedTools",
  "tool_policy.denied": "deniedTools",
  "memory_policy.enabled": "memoryEnabled",
  "memory_policy.max_items": "memoryMaxItems",
  "memory_policy.extract_after_task": "memoryExtractAfterTask",
  "execution_limits.max_steps": "maxSteps",
  "execution_limits.max_tool_calls": "maxToolCalls",
  "execution_limits.max_model_calls": "maxModelCalls",
  "execution_limits.max_duration_seconds": "maxDurationSeconds",
  "execution_limits.max_cost_usd": "maxCostUsd",
  "execution_limits.max_browser_actions": "maxBrowserActions",
  "verification_policy.readback_attempts": "readbackAttempts",
  "verification_policy.readback_delay_ms": "readbackDelayMs",
};

/** Maps `err.fieldErrors` keys to form fields; list item errors (`tool_policy.allowed.3`) map to the list. */
export function mapBackendFieldErrors(fieldErrors: Record<string, string>): Array<[keyof AgentCreateValues, string]> {
  const out: Array<[keyof AgentCreateValues, string]> = [];
  for (const [loc, message] of Object.entries(fieldErrors)) {
    const key = BACKEND_FIELD_MAP[loc] ?? BACKEND_FIELD_MAP[loc.replace(/\.\d+$/, "")];
    if (key) out.push([key, message]);
  }
  return out;
}
