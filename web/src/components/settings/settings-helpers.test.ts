import { describe, expect, it } from "vitest";
import { passwordChecks } from "./password";
import { authMethodLabel, summarizeUserAgent } from "./user-agent";

describe("summarizeUserAgent", () => {
  it("recognizes common browsers and platforms", () => {
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      ).label,
    ).toBe("Chrome 131 on macOS");
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.68",
      ).label,
    ).toBe("Edge 130 on Windows");
    expect(
      summarizeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toMatchObject({
      label: "Safari 17 on iOS",
      device: "mobile",
    });
    expect(summarizeUserAgent("Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0").label).toBe(
      "Firefox 128 on Linux",
    );
    expect(summarizeUserAgent("Python-urllib/3.11").label).toBe("Python client");
    expect(summarizeUserAgent(null)).toMatchObject({ label: "Unknown device", device: "unknown" });
  });
  it("labels auth methods", () => {
    expect(authMethodLabel("password")).toBe("Password");
    expect(authMethodLabel("google")).toBe("Google");
  });
});

describe("passwordChecks mirrors the backend strength rule", () => {
  it("requires 10+ characters and 3 of 4 character classes", () => {
    expect(passwordChecks("Sup3r-Secret!").ok).toBe(true);
    expect(passwordChecks("short1A!").ok).toBe(false);
    expect(passwordChecks("alllowercase").ok).toBe(false);
    expect(passwordChecks("lowercase123").classes).toBe(2);
    expect(passwordChecks("lowercase123!").ok).toBe(true);
    expect(passwordChecks("ÄÖÜäöüß1234").classes).toBe(3);
  });
});
