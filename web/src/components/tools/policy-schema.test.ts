import { describe, expect, it } from "vitest";
import type { ToolRuleOut } from "@/lib/api";
import { allowRuleCanWaive, rulesForTool, toolRuleDefaults, toolRuleSchema, toToolRulePayload } from "./policy-schema";

const parse = (patch: Partial<typeof toolRuleDefaults>) => toolRuleSchema.safeParse({ ...toolRuleDefaults, toolPattern: "gmail.send", ...patch });

describe("tool rule form", () => {
  it("maps to the backend payload (any role → null, empty reason → null)", () => {
    const r = parse({ effect: "deny" });
    expect(toToolRulePayload(r.data!)).toEqual({ tool_pattern: "gmail.send", effect: "deny", role: null, reason: null });
    const scoped = parse({ role: "member", reason: "  Members may not e-mail externally  " });
    expect(toToolRulePayload(scoped.data!)).toEqual({
      tool_pattern: "gmail.send",
      effect: "require_approval",
      role: "member",
      reason: "Members may not e-mail externally",
    });
  });

  it("enforces the backend pattern alphabet", () => {
    expect(parse({ toolPattern: "gmail.*" }).success).toBe(true);
    expect(parse({ toolPattern: "Gmail.send" }).success).toBe(false);
    expect(parse({ toolPattern: "gmail.s?nd" }).success).toBe(false);
    expect(parse({ toolPattern: "" }).success).toBe(false);
    expect(parse({ toolPattern: "x".repeat(129) }).success).toBe(false);
  });

  it("rejects blanket allow rules like the backend", () => {
    expect(parse({ effect: "allow", toolPattern: "*" }).success).toBe(false);
    expect(parse({ effect: "allow", toolPattern: "*.*" }).success).toBe(false);
    expect(parse({ effect: "deny", toolPattern: "*" }).success).toBe(true);
    expect(parse({ effect: "allow", toolPattern: "calendar.*" }).success).toBe(true);
  });
});

describe("engine semantics", () => {
  it("allow waives approval only for bounded writes", () => {
    expect(allowRuleCanWaive({ permission_level: "write", risk_level: "medium" })).toBe(true);
    expect(allowRuleCanWaive({ permission_level: "high_risk_write", risk_level: "low" })).toBe(true);
    expect(allowRuleCanWaive({ permission_level: "high_risk_write", risk_level: "high" })).toBe(false);
    expect(allowRuleCanWaive({ permission_level: "destructive", risk_level: "low" })).toBe(false);
    expect(allowRuleCanWaive({ permission_level: "read", risk_level: "low" })).toBe(false);
  });

  it("orders applicable rules role-specific first, then deny first", () => {
    const rules: ToolRuleOut[] = [
      { id: "1", tool_pattern: "gmail.*", effect: "allow", role: null },
      { id: "2", tool_pattern: "gmail.send", effect: "deny", role: null },
      { id: "3", tool_pattern: "gmail.*", effect: "require_approval", role: "member" },
      { id: "4", tool_pattern: "calendar.*", effect: "deny", role: null },
    ];
    expect(rulesForTool("gmail.send", rules).map((r) => r.id)).toEqual(["3", "2", "1"]);
  });
});
