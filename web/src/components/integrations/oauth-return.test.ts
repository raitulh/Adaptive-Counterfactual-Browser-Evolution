import { describe, expect, it } from "vitest";
import {
  capabilitiesForScopes,
  scopesForCapabilities,
  shortScope,
  sortCapabilities,
} from "./google-capabilities";
import { describeConnectionError, describeOAuthError, parseOAuthReturn, stripOAuthReturnParams } from "./oauth-return";

const qs = (s: string) => new URLSearchParams(s);

describe("parseOAuthReturn", () => {
  it("ignores URLs without a return status", () => {
    expect(parseOAuthReturn(qs(""))).toBeNull();
    expect(parseOAuthReturn(qs("tab=google"))).toBeNull();
    expect(parseOAuthReturn(qs("status=weird"))).toBeNull();
    expect(parseOAuthReturn(null)).toBeNull();
  });

  it("recognizes a successful connection", () => {
    expect(parseOAuthReturn(qs("status=connected"))).toEqual({ kind: "connected" });
  });

  it("maps Google and AgentOS reason codes to specific messages", () => {
    const denied = parseOAuthReturn(qs("status=error&reason=access_denied"));
    expect(denied).toMatchObject({ kind: "error", reason: "access_denied", title: "Google access was not granted", retryable: true });
    const state = parseOAuthReturn(qs("status=error&reason=oauth_state_invalid"));
    expect(state).toMatchObject({ reason: "oauth_state_invalid", title: "The connection link expired" });
    const config = parseOAuthReturn(qs("status=error&reason=configuration_missing"));
    expect(config).toMatchObject({ retryable: false });
  });

  it("falls back to a generic message for unknown or missing reasons", () => {
    expect(parseOAuthReturn(qs("status=error"))).toMatchObject({ kind: "error", reason: "unknown", title: "The connection could not be completed" });
    expect(parseOAuthReturn(qs("status=error&reason=something_new"))).toMatchObject({ reason: "something_new", retryable: true });
  });

  it("never echoes arbitrary text from the URL as the reason", () => {
    const r = describeOAuthError("<script>alert(1)</script>");
    expect(r.reason).toBe("unknown");
  });
});

describe("stripOAuthReturnParams", () => {
  it("removes status and reason but keeps other parameters", () => {
    expect(stripOAuthReturnParams("/app/integrations", qs("status=error&reason=access_denied"))).toBe("/app/integrations");
    expect(stripOAuthReturnParams("/app/integrations", qs("status=connected&focus=google"))).toBe("/app/integrations?focus=google");
  });
});

describe("describeConnectionError", () => {
  it("explains vault error codes", () => {
    expect(describeConnectionError(null)).toBeNull();
    expect(describeConnectionError("integration_revoked")).toMatch(/revoked/);
    expect(describeConnectionError("unknown_code")).toBeTruthy();
  });
});

describe("Google capability map", () => {
  it("derives capabilities from tool scopes", () => {
    expect(capabilitiesForScopes(["https://www.googleapis.com/auth/calendar.events"])).toEqual(["calendar.write"]);
    expect(
      capabilitiesForScopes(["https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/gmail.readonly", "x"]),
    ).toEqual(["gmail.read", "gmail.send"]);
  });

  it("lists the scopes a selection requests, identity scopes first", () => {
    expect(scopesForCapabilities(["drive.file"])).toEqual(["openid", "email", "profile", "https://www.googleapis.com/auth/drive.file"]);
  });

  it("sorts and filters capability ids canonically", () => {
    expect(sortCapabilities(["contacts.read", "bogus", "gmail.read"])).toEqual(["gmail.read", "contacts.read"]);
    expect(shortScope("https://www.googleapis.com/auth/gmail.send")).toBe("gmail.send");
    expect(shortScope("openid")).toBe("openid");
  });
});
