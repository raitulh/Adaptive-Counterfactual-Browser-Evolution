/**
 * The demo workspace: the signed-in "Demo User" (owner, every permission), the organization, its
 * members, sessions, policy, plans, the simulated Google account's contacts and inbox, and a month
 * of usage.
 */
import type { PermissionCode, PlanOut } from "@/lib/api";
import type { DemoStore } from "../server/store";
import { DAY, HOUR, iso, MINUTE, browserTimeZone, seedId } from "../server/util";

export const DEMO_USER_ID = seedId(0x1, 1);
export const TEAMMATE_ID = seedId(0x1, 2);
export const DEMO_ORG_ID = seedId(0x2, 1);
export const DEMO_EMAIL = "demo@agentos.example.com";

export const ALL_PERMISSIONS: PermissionCode[] = [
  "tasks:create",
  "tasks:read",
  "tasks:read_all",
  "tasks:cancel",
  "approvals:decide",
  "approvals:decide_any",
  "agents:read",
  "agents:manage",
  "memory:read",
  "memory:write",
  "tools:read",
  "tools:manage",
  "integrations:manage",
  "automations:manage",
  "files:read",
  "files:write",
  "audit:read",
  "usage:read",
  "members:manage",
  "org:manage",
  "mcp:manage",
  "billing:manage",
  "experiments:manage",
  "search:use",
];

/** Google Contacts of the simulated account (same people as the backend simulator). */
export const CONTACTS = [
  { name: "Rahim Uddin", email: "rahim@example.org" },
  { name: "Sara Chen", email: "sara.chen@example.com" },
  { name: "Omar Haddad", email: "omar@example.net" },
  { name: "Priya Nair", email: "priya.nair@example.com" },
];

/** Simulated Gmail inbox (untrusted external content). */
export const INBOX = [
  {
    id: "18f2a9c01",
    thread_id: "18f2a9c01",
    from: "Rahim Uddin <rahim@example.org>",
    subject: "Re: Partnership kickoff",
    snippet: "Thursday works for us. Could you share the agenda beforehand?",
    unread: true,
    minutesAgo: 42,
  },
  {
    id: "18f2a7b44",
    thread_id: "18f2a7b44",
    from: "Priya Nair <priya.nair@example.com>",
    subject: "Proposal feedback",
    snippet: "Overall looks great — two comments on pricing in section 3.",
    unread: true,
    minutesAgo: 95,
  },
  {
    id: "18f2a51d9",
    thread_id: "18f2a4ff0",
    from: "Sara Chen <sara.chen@example.com>",
    subject: "Launch checklist — two open items",
    snippet: "Docs review and the status page are still open. Can you own the status page?",
    unread: true,
    minutesAgo: 180,
  },
  {
    id: "18f2a2e70",
    thread_id: "18f2a2e70",
    from: "Omar Haddad <omar@example.net>",
    subject: "Launch timeline question",
    snippet: "Is the October 14 date still firm? Marketing needs to know by Friday.",
    unread: true,
    minutesAgo: 310,
  },
  {
    id: "18f29f8c3",
    thread_id: "18f29f8c3",
    from: "GitHub <noreply@github.example.com>",
    subject: "[agentos/web] PR #482 approved",
    snippet: "sara-chen approved these changes.",
    unread: false,
    minutesAgo: 420,
  },
  {
    id: "18f29a611",
    thread_id: "18f29a611",
    from: "Billing <billing@vendor.example.com>",
    subject: "Your September invoice is available",
    snippet: "Invoice INV-2026-0912 for $420.00 is ready.",
    unread: true,
    minutesAgo: 600,
  },
  {
    id: "18f2912ab",
    thread_id: "18f2912ab",
    from: "Calendar <calendar-notification@example.com>",
    subject: "Reminder: Design review at 11:00",
    snippet: "Design review — Room 4 / video link in invite.",
    unread: false,
    minutesAgo: 900,
  },
];

/** Plan catalogue (`backend/app/billing/plans.py`). */
export const PLANS: PlanOut[] = [
  {
    name: "free",
    display_name: "Free",
    monthly_quotas: {
      task_created: 200,
      model_call: 2000,
      tool_call: 5000,
      browser_seconds: 1800,
      search_query: 300,
      automation_run: 300,
    },
    features: ["calendar", "drive", "gmail", "memory", "search"],
    max_concurrent_tasks: 3,
    max_automations: 3,
    max_members: 1,
  },
  {
    name: "pro",
    display_name: "Pro",
    monthly_quotas: {
      task_created: 5000,
      model_call: 50000,
      tool_call: 100000,
      browser_seconds: 36000,
      search_query: 10000,
      automation_run: 10000,
    },
    features: ["automations", "browser", "calendar", "drive", "gmail", "mcp", "memory", "search"],
    max_concurrent_tasks: 10,
    max_automations: 50,
    max_members: 1,
  },
  {
    name: "team",
    display_name: "Team",
    monthly_quotas: {
      task_created: 50000,
      model_call: 500000,
      tool_call: 1000000,
      browser_seconds: 360000,
      search_query: 100000,
      automation_run: 100000,
    },
    features: [
      "audit_export",
      "automations",
      "browser",
      "calendar",
      "drive",
      "gmail",
      "mcp",
      "memory",
      "rbac",
      "search",
    ],
    max_concurrent_tasks: 50,
    max_automations: 500,
    max_members: 100,
  },
  {
    name: "enterprise",
    display_name: "Enterprise",
    monthly_quotas: {},
    features: [
      "audit_export",
      "automations",
      "browser",
      "calendar",
      "data_residency",
      "drive",
      "gmail",
      "mcp",
      "memory",
      "rbac",
      "search",
      "sso",
    ],
    max_concurrent_tasks: 500,
    max_automations: 10000,
    max_members: 100000,
  },
];

export const DEMO_PLAN = "team";

export function seedWorkspace(store: DemoStore, now: number): void {
  const created = iso(now - 94 * DAY);
  store.me = {
    id: DEMO_USER_ID,
    email: DEMO_EMAIL,
    display_name: "Demo User",
    email_verified: true,
    is_platform_admin: false,
    last_login_at: iso(now - 3 * MINUTE),
    locale: "en-US",
    mfa_enabled: false,
    status: "active",
    timezone: browserTimeZone(),
    created_at: created,
    role: "owner",
    permissions: [...ALL_PERMISSIONS],
    tenant_id: DEMO_ORG_ID,
  };
  store.org = {
    id: DEMO_ORG_ID,
    name: "Northwind Labs",
    slug: "northwind-labs",
    plan: DEMO_PLAN,
    status: "active",
    data_region: "eu-central",
    is_personal: false,
    role: "owner",
    created_at: created,
  };
  store.members = [
    {
      id: seedId(0x3, 1),
      user_id: DEMO_USER_ID,
      email: DEMO_EMAIL,
      display_name: "Demo User",
      role: "owner",
      status: "active",
      created_at: created,
    },
    {
      id: seedId(0x3, 2),
      user_id: TEAMMATE_ID,
      email: "sara.chen@agentos.example.com",
      display_name: "Sara Chen",
      role: "admin",
      status: "active",
      created_at: iso(now - 80 * DAY),
    },
    {
      id: seedId(0x3, 3),
      user_id: seedId(0x1, 3),
      email: "omar.haddad@agentos.example.com",
      display_name: "Omar Haddad",
      role: "member",
      status: "active",
      created_at: iso(now - 61 * DAY),
    },
    {
      id: seedId(0x3, 4),
      user_id: seedId(0x1, 4),
      email: "priya.nair@agentos.example.com",
      display_name: "Priya Nair",
      role: "member",
      status: "active",
      created_at: iso(now - 33 * DAY),
    },
    {
      id: seedId(0x3, 5),
      user_id: seedId(0x1, 5),
      email: "finance@agentos.example.com",
      display_name: "Finance (read-only)",
      role: "viewer",
      status: "active",
      created_at: iso(now - 12 * DAY),
    },
  ];
  store.sessions = [
    {
      id: store.auth.sessionId,
      auth_method: "password",
      device_name: "Chrome on macOS",
      ip_address: "203.0.113.24",
      user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Chrome/129",
      created_at: iso(now - 3 * MINUTE),
      last_seen_at: iso(now),
      expires_at: iso(now + 30 * DAY),
      revoked_at: null,
      current: true,
    },
    {
      id: seedId(0x4, 2),
      auth_method: "google",
      device_name: "Safari on iPhone",
      ip_address: "198.51.100.7",
      user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
      created_at: iso(now - 6 * DAY),
      last_seen_at: iso(now - 9 * HOUR),
      expires_at: iso(now + 24 * DAY),
      revoked_at: null,
      current: false,
    },
  ];
  store.policy = {
    version: 4,
    policy: {
      allow_destructive_actions: false,
      allow_financial_actions: false,
      always_require_approval: [],
      approval_ttl_seconds: 24 * 3600,
      blocked_tools: [],
      browser_allowed_domains: ["*.example.com", "*.example.org"],
      browser_denied_domains: ["*.bank.example"],
      extra: {},
      internal_email_domains: ["agentos.example.com"],
      max_concurrent_tasks: 10,
    },
  };
  seedUsage(store, now);
}

/** A month of plausible daily usage (deterministic pseudo-random, weekends quieter). */
function seedUsage(store: DemoStore, now: number): void {
  const today = new Date(now);
  const first = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1);
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let day = first; day < now - DAY / 2; day += DAY) {
    const weekend = [0, 6].includes(new Date(day).getUTCDay());
    const k = weekend ? 0.35 : 1;
    const tasks = Math.round((4 + rand() * 6) * k);
    const add = (kind: string, qty: number, cost = 0) => store.addUsage(kind, Math.round(qty), cost, day + 12 * HOUR);
    add("task_created", tasks);
    add("model_call", tasks * (2.2 + rand()), tasks * 0.024);
    add("model_input_tokens", tasks * (6800 + rand() * 2500));
    add("model_output_tokens", tasks * (900 + rand() * 500));
    add("tool_call", tasks * (3 + rand() * 3));
    add("search_query", tasks * rand() * 0.8);
    add("automation_run", weekend ? 0 : 1);
    add("embedding", tasks * (14 + rand() * 20));
  }
  store.addUsage("storage_bytes", 38_604_812, 0, first + 2 * HOUR);
}
