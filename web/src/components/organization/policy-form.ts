/**
 * OrganizationPolicy ↔ editor form mapping (pure, unit-tested).
 *
 * The backend model (app/organizations/schemas.py `OrganizationPolicy`, extra="forbid") is replaced
 * wholesale by `PUT /organizations/current/policy`, so the payload always carries every field —
 * including `extra`, which the editor does not change but must preserve.
 *
 * Semantics (from the backend):
 *  - blocked_tools / always_require_approval: fnmatch glob patterns on tool names ("gmail.send", "browser.*").
 *  - allow_destructive_actions / allow_financial_actions: those tools are denied unless enabled, and
 *    always need approval when enabled.
 *  - internal_email_domains: exact domains; e-mail to anyone else is high risk (approval).
 *  - browser_allowed_domains / browser_denied_domains: "example.com" matches itself and subdomains,
 *    "*.example.com" matches subdomains.
 *  - approval_ttl_seconds: 60 … 604 800 (7 days), null = platform default.
 *  - max_concurrent_tasks: 1 … 1000 per user, null = no organization limit (plan limits still apply).
 */
import type { OrganizationPolicy } from "@/lib/api";

export const APPROVAL_TTL_MIN_SECONDS = 60;
export const APPROVAL_TTL_MAX_SECONDS = 7 * 24 * 3600;
export const MAX_CONCURRENT_MIN = 1;
export const MAX_CONCURRENT_MAX = 1000;

export type TtlUnit = "minutes" | "hours" | "days";
export const TTL_UNIT_SECONDS: Record<TtlUnit, number> = { minutes: 60, hours: 3600, days: 86400 };

export interface PolicyFormValues {
  blocked_tools: string[];
  always_require_approval: string[];
  allow_destructive_actions: boolean;
  allow_financial_actions: boolean;
  internal_email_domains: string[];
  browser_allowed_domains: string[];
  browser_denied_domains: string[];
  approval_ttl_custom: boolean;
  approval_ttl_value: number;
  approval_ttl_unit: TtlUnit;
  max_concurrent_custom: boolean;
  max_concurrent_value: number;
}

/** Largest unit that represents the duration exactly (falls back to fractional minutes). */
export function secondsToTtl(seconds: number): { value: number; unit: TtlUnit } {
  if (seconds % TTL_UNIT_SECONDS.days === 0) return { value: seconds / TTL_UNIT_SECONDS.days, unit: "days" };
  if (seconds % TTL_UNIT_SECONDS.hours === 0) return { value: seconds / TTL_UNIT_SECONDS.hours, unit: "hours" };
  return { value: Math.round((seconds / 60) * 100) / 100, unit: "minutes" };
}

export function ttlToSeconds(value: number, unit: TtlUnit): number {
  return Math.round(value * TTL_UNIT_SECONDS[unit]);
}

export function policyToForm(policy: OrganizationPolicy): PolicyFormValues {
  const ttl = policy.approval_ttl_seconds ?? null;
  const ttlParts = ttl !== null ? secondsToTtl(ttl) : { value: 24, unit: "hours" as TtlUnit };
  return {
    blocked_tools: [...(policy.blocked_tools ?? [])],
    always_require_approval: [...(policy.always_require_approval ?? [])],
    allow_destructive_actions: Boolean(policy.allow_destructive_actions),
    allow_financial_actions: Boolean(policy.allow_financial_actions),
    internal_email_domains: [...(policy.internal_email_domains ?? [])],
    browser_allowed_domains: [...(policy.browser_allowed_domains ?? [])],
    browser_denied_domains: [...(policy.browser_denied_domains ?? [])],
    approval_ttl_custom: ttl !== null,
    approval_ttl_value: ttlParts.value,
    approval_ttl_unit: ttlParts.unit,
    max_concurrent_custom: policy.max_concurrent_tasks !== null && policy.max_concurrent_tasks !== undefined,
    max_concurrent_value: policy.max_concurrent_tasks ?? 5,
  };
}

// ------------------------------------------------------------------------------------ list entries
/** "https://Docs.Example.com/path" → "docs.example.com"; keeps a leading "*." wildcard. */
export function normalizeDomain(input: string): string {
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  s = s.replace(/^[^@/]*@/, ""); // user@ in URLs / e-mail addresses → domain
  s = s.split(/[/?#]/)[0] ?? "";
  s = s.replace(/:\d+$/, ""); // port
  return s.replace(/\.+$/, "");
}

const DOMAIN_RE = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PLAIN_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const TOOL_PATTERN_RE = /^[A-Za-z0-9_.*?[\]!:-]{1,200}$/;

export type EntryKind = "tool-pattern" | "domain-pattern" | "domain";

export function normalizeEntry(kind: EntryKind, input: string): string {
  return kind === "tool-pattern" ? input.trim() : normalizeDomain(input);
}

/** Returns an error message, or null when the (normalized) entry is valid. */
export function validateEntry(kind: EntryKind, value: string): string | null {
  if (!value) return "Enter a value";
  if (kind === "tool-pattern")
    return TOOL_PATTERN_RE.test(value) ? null : "Use a tool name or glob like gmail.send or browser.*";
  if (kind === "domain") return PLAIN_DOMAIN_RE.test(value) ? null : "Use a domain like example.com";
  return DOMAIN_RE.test(value) ? null : "Use a domain like example.com or *.example.com";
}

/** Normalize, drop empties and duplicates (case-insensitive for domains), preserving order. */
export function cleanList(kind: EntryKind, values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = normalizeEntry(kind, raw);
    if (!v) continue;
    const key = kind === "tool-pattern" ? v : v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/** Split pasted text ("a.com, b.com\nc.com") into entries. */
export function splitEntries(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ------------------------------------------------------------------------------------ validation + payload
export type PolicyFormErrors = Partial<Record<keyof PolicyFormValues, string>>;

export function validatePolicyForm(values: PolicyFormValues): PolicyFormErrors {
  const errors: PolicyFormErrors = {};
  if (values.approval_ttl_custom) {
    const s = ttlToSeconds(values.approval_ttl_value, values.approval_ttl_unit);
    if (!Number.isFinite(s) || s < APPROVAL_TTL_MIN_SECONDS || s > APPROVAL_TTL_MAX_SECONDS) {
      errors.approval_ttl_value = "Between 1 minute and 7 days";
    }
  }
  if (values.max_concurrent_custom) {
    const n = values.max_concurrent_value;
    if (!Number.isInteger(n) || n < MAX_CONCURRENT_MIN || n > MAX_CONCURRENT_MAX) {
      errors.max_concurrent_value = `A whole number from ${MAX_CONCURRENT_MIN} to ${MAX_CONCURRENT_MAX}`;
    }
  }
  const lists: Array<[keyof PolicyFormValues, EntryKind]> = [
    ["blocked_tools", "tool-pattern"],
    ["always_require_approval", "tool-pattern"],
    ["internal_email_domains", "domain"],
    ["browser_allowed_domains", "domain-pattern"],
    ["browser_denied_domains", "domain-pattern"],
  ];
  for (const [field, kind] of lists) {
    const bad = (values[field] as string[])
      .map((v) => normalizeEntry(kind, v))
      .find((v) => validateEntry(kind, v) !== null);
    if (bad !== undefined) errors[field] = `“${bad}” is not valid. ${validateEntry(kind, bad)}`;
  }
  return errors;
}

/** Build the full PUT body. `base` supplies fields the editor does not manage (`extra`). */
export function formToPolicy(values: PolicyFormValues, base: OrganizationPolicy): OrganizationPolicy {
  return {
    blocked_tools: cleanList("tool-pattern", values.blocked_tools),
    always_require_approval: cleanList("tool-pattern", values.always_require_approval),
    allow_destructive_actions: values.allow_destructive_actions,
    allow_financial_actions: values.allow_financial_actions,
    internal_email_domains: cleanList("domain", values.internal_email_domains),
    browser_allowed_domains: cleanList("domain-pattern", values.browser_allowed_domains),
    browser_denied_domains: cleanList("domain-pattern", values.browser_denied_domains),
    approval_ttl_seconds: values.approval_ttl_custom
      ? ttlToSeconds(values.approval_ttl_value, values.approval_ttl_unit)
      : null,
    max_concurrent_tasks: values.max_concurrent_custom ? Math.trunc(values.max_concurrent_value) : null,
    extra: { ...(base.extra ?? {}) },
  };
}

export interface PolicyChange {
  field: keyof OrganizationPolicy;
  label: string;
  before: string;
  after: string;
}

export const POLICY_LABELS: Record<Exclude<keyof OrganizationPolicy, "extra">, string> = {
  blocked_tools: "Blocked tools",
  always_require_approval: "Always require approval",
  allow_destructive_actions: "Destructive actions",
  allow_financial_actions: "Financial actions",
  internal_email_domains: "Internal e-mail domains",
  browser_allowed_domains: "Browser allowlist",
  browser_denied_domains: "Browser denylist",
  approval_ttl_seconds: "Approval expiry",
  max_concurrent_tasks: "Concurrent tasks per user",
};

export function describeTtl(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "Platform default";
  const { value, unit } = secondsToTtl(seconds);
  const singular = unit.slice(0, -1);
  return `${value} ${value === 1 ? singular : unit}`;
}

function show(field: keyof OrganizationPolicy, value: unknown): string {
  if (field === "approval_ttl_seconds") return describeTtl(value as number | null);
  if (field === "max_concurrent_tasks")
    return value === null || value === undefined ? "No organization limit" : String(value);
  if (field === "allow_destructive_actions" || field === "allow_financial_actions")
    return value ? "Allowed (with approval)" : "Blocked";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "None";
  return JSON.stringify(value);
}

/** Human-readable list of what a save would change (for the review dialog). */
export function diffPolicy(before: OrganizationPolicy, after: OrganizationPolicy): PolicyChange[] {
  const changes: PolicyChange[] = [];
  for (const field of Object.keys(POLICY_LABELS) as Array<keyof typeof POLICY_LABELS>) {
    const a = before[field] ?? (Array.isArray(after[field]) ? [] : field.startsWith("allow_") ? false : null);
    const b = after[field];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changes.push({ field, label: POLICY_LABELS[field], before: show(field, a), after: show(field, b) });
    }
  }
  return changes;
}
