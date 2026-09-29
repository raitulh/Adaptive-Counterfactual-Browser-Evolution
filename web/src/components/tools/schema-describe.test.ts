import { describe, expect, it } from "vitest";
import { allowsAdditional, describeSchema } from "./schema-describe";

describe("describeSchema", () => {
  it("lists properties with type, required flag, constraints and defaults", () => {
    const rows = describeSchema({
      type: "object",
      additionalProperties: false,
      required: ["to", "subject"],
      properties: {
        to: { type: "array", items: { type: "string", format: "email" }, minItems: 1, maxItems: 50 },
        subject: { type: "string", minLength: 1, maxLength: 500, description: "Subject line" },
        location: { anyOf: [{ type: "string", maxLength: 500 }, { type: "null" }], default: null },
        send_updates: { type: "string", default: "all", pattern: "^(all|none)$" },
      },
    });
    expect(rows.map((r) => [r.name, r.type, r.required])).toEqual([
      ["to", "string (email)[]", true],
      ["subject", "string", true],
      ["location", "string", false],
      ["send_updates", "string", false],
    ]);
    expect(rows[0].constraints).toEqual(["1–50 items"]);
    expect(rows[1]).toMatchObject({ description: "Subject line", constraints: ["1–500 chars"] });
    expect(rows[2]).toMatchObject({ nullable: true, defaultValue: "null", constraints: ["≤ 500 chars"] });
    expect(rows[3].defaultValue).toBe("all");
  });

  it("resolves local $ref and nested objects, and never follows remote refs", () => {
    const rows = describeSchema({
      type: "object",
      $defs: { Mode: { type: "string", enum: ["fast", "safe"] }, Opts: { type: "object", properties: { mode: { $ref: "#/$defs/Mode" } } } },
      properties: { options: { $ref: "#/$defs/Opts" }, remote: { $ref: "https://evil.example/schema.json" } },
    });
    expect(rows.map((r) => r.path)).toEqual(["options", "options.mode", "remote"]);
    expect(rows[1]).toMatchObject({ type: "enum", enumValues: ["fast", "safe"] });
    expect(rows[2].type).toBe("any");
  });

  it("handles empty and invalid schemas", () => {
    expect(describeSchema(null)).toEqual([]);
    expect(describeSchema({ type: "object" })).toEqual([]);
    expect(allowsAdditional({ type: "object", additionalProperties: false })).toBe(false);
    expect(allowsAdditional({ type: "object" })).toBe(true);
  });
});
