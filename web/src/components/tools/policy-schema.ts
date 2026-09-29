/**
 * Organization tool rules (`ToolRuleIn`, app/tools/router.py): form schema, payload mapping and the
 * plain-language semantics of the permission engine (app/permissions/service.py, step 7).
 */
import { z } from "zod";
import type { SystemRole, ToolOut, ToolRuleIn, ToolRuleOut } from "@/lib/api";
import type { Tone } from "@/lib/status";
import { matchesPattern } from "./glob";

export type RuleEffect = ToolRuleIn["effect"];

export const RULE_EFFECTS: RuleEffect[] = ["deny", "require_approval", "allow"];

export const ruleEffectMeta: Record<RuleEffect, { label: string; tone: Tone; description: string }> = {
  deny: {
    label: "Deny",
    tone: "danger",
    description: "Agents can never call matching tools. Overrides every allow or approval rule.",
  },
  require_approval: {
    label: "Require approval",
    tone: "warning",
    description: "Every call to a matching tool waits for a person to approve it.",
  },
  allow: {
    label: "Allow without approval",
    tone: "success",
    description:
      "Waives the default approval for bounded writes (write or high-risk write at low/medium risk). It never grants a denied or blocked tool.",
  },
};

export const ROLE_OPTIONS: Array<{ value: SystemRole; label: string }> = [
  { value: "owner", label: "Owners" },
  { value: "admin", label: "Admins" },
  { value: "member", label: "Members" },
  { value: "viewer", label: "Viewers" },
];

export const toolRuleSchema = z
  .object({
    toolPattern: z
      .string()
      .trim()
      .min(1, "Enter a tool name or pattern")
      .max(128, "At most 128 characters")
      .regex(/^[a-z0-9_.*]+$/, "Use lowercase letters, digits, '_', '.' and '*' only"),
    effect: z.enum(["deny", "require_approval", "allow"]),
    role: z.union([z.literal("any"), z.enum(["owner", "admin", "member", "viewer"])]),
    reason: z.string().trim().max(500, "At most 500 characters"),
  })
  .superRefine((v, ctx) => {
    if (v.effect === "allow" && (v.toolPattern === "*" || v.toolPattern === "*.*")) {
      ctx.addIssue({ code: "custom", path: ["toolPattern"], message: "A blanket allow rule is not permitted; name the tools explicitly" });
    }
  });

export type ToolRuleValues = z.infer<typeof toolRuleSchema>;

export const toolRuleDefaults: ToolRuleValues = { toolPattern: "", effect: "require_approval", role: "any", reason: "" };

export function toToolRulePayload(v: ToolRuleValues): ToolRuleIn {
  return {
    tool_pattern: v.toolPattern.trim(),
    effect: v.effect,
    role: v.role === "any" ? null : v.role,
    reason: v.reason.trim() === "" ? null : v.reason.trim(),
  };
}

/**
 * What an allow rule can actually change for a tool, per the engine: approval is waived only for
 * write/high-risk-write tools at low or medium risk (and never for untrusted-derived arguments or
 * when the model asks for approval at run time).
 */
export function allowRuleCanWaive(tool: Pick<ToolOut, "permission_level" | "risk_level">): boolean {
  const bounded = tool.permission_level === "write" || tool.permission_level === "high_risk_write";
  return bounded && (tool.risk_level === "low" || tool.risk_level === "medium");
}

/** Rules that apply to a tool, in the engine's evaluation order (role-specific first, deny first). */
export function rulesForTool(name: string, rules: readonly ToolRuleOut[]): ToolRuleOut[] {
  return rules
    .filter((r) => matchesPattern(name, r.tool_pattern))
    .sort((a, b) => Number(a.role == null) - Number(b.role == null) || Number(a.effect !== "deny") - Number(b.effect !== "deny"));
}
