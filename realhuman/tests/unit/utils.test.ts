import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";
import {
  formatDelta,
  formatDuration,
  formatOffset,
  formatScore,
  formatUtcTime,
  maskId,
  maskSecret,
} from "@/lib/utils/format";
import { tokenize, tokenizeLines } from "@/lib/utils/highlight";
import { createSeededRandom } from "@/lib/utils/random";
import { isInternalHref, joinUrl, toSafeExternalUrl } from "@/lib/utils/url";

describe("format", () => {
  it("masks identifiers but keeps the prefix", () => {
    expect(maskId("sess_7f3a9c2e41d8")).toBe("sess_7f3a…41d8");
    expect(maskId("short_id")).toBe("short_id");
  });

  it("masks secrets down to the type prefix and last four characters", () => {
    expect(maskSecret("rh_test_sk_9f8e7d6c5b4a3f2e")).toBe("rh_test_sk_••••••••3f2e");
    expect(maskSecret("abc")).toBe("••••••••");
  });

  it("formats scores, deltas and durations", () => {
    expect(formatScore(0.934)).toBe("0.93");
    expect(formatScore(1.4)).toBe("1.00");
    expect(formatDelta(12.345)).toBe("+12.3%");
    expect(formatDelta(-4)).toBe("−4.0%");
    expect(formatDuration(87)).toBe("87ms");
    expect(formatDuration(1520)).toBe("1.52s");
    expect(formatOffset(-5)).toBe("+0ms");
  });

  it("formats times in UTC regardless of the local timezone", () => {
    expect(formatUtcTime("2026-09-24T12:04:31Z")).toBe("12:04:31 UTC");
  });
});

describe("url", () => {
  it("accepts https and loopback http only", () => {
    expect(toSafeExternalUrl("https://github.com/org/repo")).toBe("https://github.com/org/repo");
    expect(toSafeExternalUrl("http://localhost:8000")).toBe("http://localhost:8000/");
    expect(toSafeExternalUrl("http://example.com")).toBeNull();
    expect(toSafeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(toSafeExternalUrl("https://user:pass@example.com")).toBeNull();
    expect(toSafeExternalUrl("not a url")).toBeNull();
    expect(toSafeExternalUrl(undefined)).toBeNull();
  });

  it("classifies internal hrefs and joins paths", () => {
    expect(isInternalHref("/docs")).toBe(true);
    expect(isInternalHref("//evil.example")).toBe(false);
    expect(joinUrl("https://api.example.test/", "/v1/verify")).toBe(
      "https://api.example.test/v1/verify",
    );
  });
});

describe("env", () => {
  it("applies safe defaults", () => {
    expect(parseEnv({})).toEqual({
      NEXT_PUBLIC_PRODUCT_NAME: "RealHuman",
      NEXT_PUBLIC_SITE_URL: undefined,
      NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000",
      NEXT_PUBLIC_VERIFICATION_MODE: "mock",
      NEXT_PUBLIC_ENABLE_DEMO: true,
      NEXT_PUBLIC_ENABLE_3D: true,
      NEXT_PUBLIC_GITHUB_URL: undefined,
    });
  });

  it("parses flags and overrides", () => {
    const env = parseEnv({
      NEXT_PUBLIC_PRODUCT_NAME: "Acme Verify",
      NEXT_PUBLIC_VERIFICATION_MODE: "live",
      NEXT_PUBLIC_ENABLE_3D: "false",
      NEXT_PUBLIC_ENABLE_DEMO: "0",
      NEXT_PUBLIC_GITHUB_URL: "javascript:alert(1)",
    });
    expect(env.NEXT_PUBLIC_PRODUCT_NAME).toBe("Acme Verify");
    expect(env.NEXT_PUBLIC_VERIFICATION_MODE).toBe("live");
    expect(env.NEXT_PUBLIC_ENABLE_3D).toBe(false);
    expect(env.NEXT_PUBLIC_ENABLE_DEMO).toBe(false);
    expect(env.NEXT_PUBLIC_GITHUB_URL).toBeUndefined();
  });
});

describe("highlight", () => {
  it("never drops characters", () => {
    const code = `const x = await realhuman.verify("tok"); // done`;
    expect(
      tokenize(code, "ts")
        .map((t) => t.value)
        .join(""),
    ).toBe(code);
  });

  it("classifies TypeScript tokens", () => {
    const tokens = tokenize(`const ok = verify("a", 1);`, "ts");
    const find = (value: string) => tokens.find((t) => t.value === value)?.type;
    expect(find("const")).toBe("keyword");
    expect(find("verify")).toBe("function");
    expect(find('"a"')).toBe("string");
    expect(find("1")).toBe("number");
  });

  it("highlights shell variables inside double-quoted strings", () => {
    const tokens = tokenize(`curl "$REALHUMAN_API_URL/v1/verify"`, "bash");
    expect(tokens.find((t) => t.value === "$REALHUMAN_API_URL")?.type).toBe("variable");
    expect(tokens.find((t) => t.value === "curl")?.type).toBe("keyword");
  });

  it("distinguishes JSON keys from values", () => {
    const tokens = tokenize(`{ "verified": true, "risk": "low" }`, "json");
    expect(tokens.find((t) => t.value === '"verified"')?.type).toBe("property");
    expect(tokens.find((t) => t.value === '"low"')?.type).toBe("string");
    expect(tokens.find((t) => t.value === "true")?.type).toBe("literal");
  });

  it("splits tokens into lines", () => {
    expect(tokenizeLines("a\n\nb", "ts")).toHaveLength(3);
  });
});

describe("seeded random", () => {
  it("is reproducible", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
