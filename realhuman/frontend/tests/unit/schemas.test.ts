import { describe, expect, it } from "vitest";
import {
  contactSchema,
  createApiKeySchema,
  createWebhookSchema,
  loginSchema,
  projectSettingsSchema,
  signupSchema,
} from "@/lib/schemas/forms";

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);

describe("form schemas", () => {
  it("validates login input", () => {
    expect(loginSchema.safeParse({ email: "dev@example.com", password: "x" }).success).toBe(true);
    expect(messages(loginSchema.safeParse({ email: "", password: "" }))).toEqual([
      "Enter your email address.",
      "Enter your password.",
    ]);
    expect(messages(loginSchema.safeParse({ email: "nope", password: "x" }))).toEqual([
      "Enter a valid email address.",
    ]);
  });

  it("requires strong passwords on signup", () => {
    expect(
      messages(signupSchema.safeParse({ email: "dev@example.com", password: "short" })),
    ).toEqual(["Use at least 12 characters."]);
  });

  it("validates API key names", () => {
    expect(
      createApiKeySchema.safeParse({ name: "Prod backend", environment: "live" }).success,
    ).toBe(true);
    expect(createApiKeySchema.safeParse({ name: "<script>", environment: "live" }).success).toBe(
      false,
    );
  });

  it("requires https webhook endpoints and at least one event", () => {
    expect(
      createWebhookSchema.safeParse({
        url: "https://hooks.example.test/rh",
        events: ["session.expired"],
      }).success,
    ).toBe(true);
    expect(
      messages(
        createWebhookSchema.safeParse({
          url: "http://hooks.example.test",
          events: ["session.expired"],
        }),
      ),
    ).toEqual(["Use an https:// URL."]);
    expect(
      messages(createWebhookSchema.safeParse({ url: "https://hooks.example.test", events: [] })),
    ).toEqual(["Select at least one event."]);
  });

  it("enforces threshold ordering in project settings", () => {
    const base = {
      projectName: "Demo",
      allowThreshold: 0.8,
      stepUpThreshold: 0.5,
      retentionDays: "7" as const,
    };
    expect(projectSettingsSchema.safeParse(base).success).toBe(true);
    expect(messages(projectSettingsSchema.safeParse({ ...base, stepUpThreshold: 0.85 }))).toContain(
      "Step-up threshold must be lower than the allow threshold.",
    );
  });

  it("accepts optional contact fields", () => {
    expect(contactSchema.safeParse({ name: "Ada", email: "ada@example.com" }).success).toBe(true);
  });
});
