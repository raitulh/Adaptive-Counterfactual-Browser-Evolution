import { describe, expect, it } from "vitest";
import type { OrganizationPolicy } from "@/lib/api";
import {
  cleanList,
  diffPolicy,
  formToPolicy,
  normalizeDomain,
  policyToForm,
  secondsToTtl,
  splitEntries,
  ttlToSeconds,
  validateEntry,
  validatePolicyForm,
} from "./policy-form";

const EMPTY: OrganizationPolicy = {
  blocked_tools: [],
  always_require_approval: [],
  allow_destructive_actions: false,
  allow_financial_actions: false,
  internal_email_domains: [],
  browser_allowed_domains: [],
  browser_denied_domains: [],
  approval_ttl_seconds: null,
  max_concurrent_tasks: null,
  extra: {},
};

describe("policy form mapping", () => {
  it("round-trips the default policy to an identical payload", () => {
    expect(formToPolicy(policyToForm(EMPTY), EMPTY)).toEqual(EMPTY);
  });

  it("round-trips a fully populated policy and preserves `extra` untouched", () => {
    const policy: OrganizationPolicy = {
      blocked_tools: ["browser.*"],
      always_require_approval: ["gmail.create_draft", "calendar.*_event"],
      allow_destructive_actions: true,
      allow_financial_actions: false,
      internal_email_domains: ["northwind.com"],
      browser_allowed_domains: ["docs.example.com", "*.wiki.example.com"],
      browser_denied_domains: ["evil.example"],
      approval_ttl_seconds: 2 * 3600,
      max_concurrent_tasks: 4,
      extra: { retention_days: 30, nested: { a: [1, 2] } },
    };
    const form = policyToForm(policy);
    expect(form.approval_ttl_custom).toBe(true);
    expect(form.approval_ttl_value).toBe(2);
    expect(form.approval_ttl_unit).toBe("hours");
    expect(form.max_concurrent_custom).toBe(true);
    expect(form.max_concurrent_value).toBe(4);
    expect(formToPolicy(form, policy)).toEqual(policy);
  });

  it("fills in missing optional fields from an older stored policy", () => {
    const partial = { blocked_tools: ["gmail.send"] } as OrganizationPolicy;
    const payload = formToPolicy(policyToForm(partial), partial);
    expect(payload).toEqual({ ...EMPTY, blocked_tools: ["gmail.send"] });
  });

  it("maps 'platform default' switches to null and custom values to seconds / integers", () => {
    const form = policyToForm(EMPTY);
    expect(
      formToPolicy({ ...form, approval_ttl_custom: false, approval_ttl_value: 3, approval_ttl_unit: "days" }, EMPTY)
        .approval_ttl_seconds,
    ).toBeNull();
    expect(
      formToPolicy({ ...form, approval_ttl_custom: true, approval_ttl_value: 3, approval_ttl_unit: "days" }, EMPTY)
        .approval_ttl_seconds,
    ).toBe(259200);
    expect(
      formToPolicy({ ...form, approval_ttl_custom: true, approval_ttl_value: 1.5, approval_ttl_unit: "minutes" }, EMPTY)
        .approval_ttl_seconds,
    ).toBe(90);
    expect(
      formToPolicy({ ...form, max_concurrent_custom: false, max_concurrent_value: 9 }, EMPTY).max_concurrent_tasks,
    ).toBeNull();
    expect(
      formToPolicy({ ...form, max_concurrent_custom: true, max_concurrent_value: 9 }, EMPTY).max_concurrent_tasks,
    ).toBe(9);
  });

  it("normalizes, lowercases and de-duplicates list entries in the payload", () => {
    const form = {
      ...policyToForm(EMPTY),
      browser_allowed_domains: ["https://Docs.Example.com/path?q=1", "docs.example.com", " ", "*.Wiki.example.com."],
      internal_email_domains: ["alice@Northwind.com", "northwind.com"],
      blocked_tools: [" gmail.send ", "gmail.send", "browser.*"],
    };
    const payload = formToPolicy(form, EMPTY);
    expect(payload.browser_allowed_domains).toEqual(["docs.example.com", "*.wiki.example.com"]);
    expect(payload.internal_email_domains).toEqual(["northwind.com"]);
    expect(payload.blocked_tools).toEqual(["gmail.send", "browser.*"]);
  });
});

describe("ttl units", () => {
  it("picks the largest exact unit", () => {
    expect(secondsToTtl(86400)).toEqual({ value: 1, unit: "days" });
    expect(secondsToTtl(7200)).toEqual({ value: 2, unit: "hours" });
    expect(secondsToTtl(5400)).toEqual({ value: 90, unit: "minutes" });
    expect(secondsToTtl(90)).toEqual({ value: 1.5, unit: "minutes" });
    expect(ttlToSeconds(1.5, "minutes")).toBe(90);
  });
});

describe("validation mirrors the backend constraints", () => {
  const base = policyToForm(EMPTY);
  it("enforces approval expiry between 60 s and 7 days", () => {
    expect(
      validatePolicyForm({ ...base, approval_ttl_custom: true, approval_ttl_value: 30, approval_ttl_unit: "minutes" }),
    ).toEqual({});
    expect(
      validatePolicyForm({ ...base, approval_ttl_custom: true, approval_ttl_value: 0.5, approval_ttl_unit: "minutes" })
        .approval_ttl_value,
    ).toBeTruthy();
    expect(
      validatePolicyForm({ ...base, approval_ttl_custom: true, approval_ttl_value: 8, approval_ttl_unit: "days" })
        .approval_ttl_value,
    ).toBeTruthy();
    expect(
      validatePolicyForm({ ...base, approval_ttl_custom: true, approval_ttl_value: 7, approval_ttl_unit: "days" }),
    ).toEqual({});
    // Ignored while the default is selected.
    expect(
      validatePolicyForm({ ...base, approval_ttl_custom: false, approval_ttl_value: 0, approval_ttl_unit: "minutes" }),
    ).toEqual({});
  });

  it("enforces concurrent tasks as an integer from 1 to 1000", () => {
    expect(
      validatePolicyForm({ ...base, max_concurrent_custom: true, max_concurrent_value: 0 }).max_concurrent_value,
    ).toBeTruthy();
    expect(
      validatePolicyForm({ ...base, max_concurrent_custom: true, max_concurrent_value: 1001 }).max_concurrent_value,
    ).toBeTruthy();
    expect(
      validatePolicyForm({ ...base, max_concurrent_custom: true, max_concurrent_value: 2.5 }).max_concurrent_value,
    ).toBeTruthy();
    expect(validatePolicyForm({ ...base, max_concurrent_custom: true, max_concurrent_value: 1000 })).toEqual({});
  });

  it("rejects malformed domains and tool patterns", () => {
    expect(validatePolicyForm({ ...base, internal_email_domains: ["*.example.com"] }).internal_email_domains).toMatch(
      /not valid/,
    );
    expect(
      validatePolicyForm({ ...base, browser_denied_domains: ["not a domain"] }).browser_denied_domains,
    ).toBeTruthy();
    expect(validatePolicyForm({ ...base, blocked_tools: ["gmail send"] }).blocked_tools).toBeTruthy();
    expect(validateEntry("domain-pattern", "*.example.com")).toBeNull();
    expect(validateEntry("tool-pattern", "calendar.*_event")).toBeNull();
  });
});

describe("list helpers", () => {
  it("normalizes domains from URLs and e-mail addresses", () => {
    expect(normalizeDomain("HTTPS://a.B.com:8443/x")).toBe("a.b.com");
    expect(normalizeDomain("bob@corp.example.com")).toBe("corp.example.com");
    expect(normalizeDomain("*.Example.com.")).toBe("*.example.com");
  });
  it("splits pasted lists", () => {
    expect(splitEntries("a.com, b.com\nc.com;d.com  e.com")).toEqual(["a.com", "b.com", "c.com", "d.com", "e.com"]);
    expect(cleanList("domain", ["A.com", "a.com"])).toEqual(["a.com"]);
  });
});

describe("diffPolicy", () => {
  it("describes only the fields that change, in human terms", () => {
    const after = {
      ...EMPTY,
      allow_financial_actions: true,
      approval_ttl_seconds: 3600,
      browser_denied_domains: ["x.com"],
    };
    const changes = diffPolicy(EMPTY, after);
    expect(changes.map((c) => c.field)).toEqual([
      "allow_financial_actions",
      "browser_denied_domains",
      "approval_ttl_seconds",
    ]);
    expect(changes[0]).toMatchObject({ before: "Blocked", after: "Allowed (with approval)" });
    expect(changes[2]).toMatchObject({ before: "Platform default", after: "1 hour" });
  });
  it("treats absent lists as empty", () => {
    expect(diffPolicy({} as OrganizationPolicy, EMPTY)).toEqual([]);
  });
});
