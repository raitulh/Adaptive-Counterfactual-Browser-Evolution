/** Users, organization, members, policy, billing, usage, audit, notifications and health. */
import type { MemberOut, NotificationOut, OrganizationPolicy, SystemRole, UsageSummary } from "@/lib/api";
import { DEMO_PLAN, PLANS } from "../../fixtures/workspace";
import { Body, conflict, type Ctx, json, noContent, notFound, paginate, queryBool, queryUuid } from "../http";
import type { Router, Srv } from "../router";
import type { NotificationRec } from "../store";
import { clone, iso, uuid } from "../util";
import { can, requirePermission } from "./common";

const ROLES = ["owner", "admin", "member", "viewer"] as const satisfies readonly SystemRole[];

function me(ctx: Ctx, { store }: Srv) {
  return json(ctx, 200, clone(store.me));
}

async function updateMe(ctx: Ctx, { store }: Srv) {
  const b = new Body(await ctx.json());
  const displayName = b.optStr("display_name", { max: 200 });
  const locale = b.optStr("locale", { min: 2, max: 20 });
  const timezone = b.optStr("timezone", { max: 64 });
  if (timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch {
      b.fail("timezone", "Value error, unknown time zone");
    }
  }
  b.done();
  if (b.has("display_name")) store.me.display_name = displayName;
  if (locale) store.me.locale = locale;
  if (timezone) store.me.timezone = timezone;
  store.audit(
    { category: "account", action: "user.update", resource_type: "user", resource_id: store.me.id },
    ctx.requestId,
  );
  const { role: _role, permissions: _p, tenant_id: _t, ...user } = store.me;
  void _role;
  void _p;
  void _t;
  return json(ctx, 200, clone(user));
}

async function updateOrg(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "org:manage");
  const b = new Body(await ctx.json());
  const name = b.optStr("name", { min: 1, max: 200 });
  b.done();
  if (name) store.org.name = name;
  store.audit(
    { category: "admin", action: "organization.update", resource_type: "organization", resource_id: store.org.id },
    ctx.requestId,
  );
  return json(ctx, 200, clone(store.org));
}

async function updatePolicy(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "org:manage");
  const b = new Body(await ctx.json());
  const lists = [
    "always_require_approval",
    "blocked_tools",
    "browser_allowed_domains",
    "browser_denied_domains",
    "internal_email_domains",
  ] as const;
  const next: OrganizationPolicy = { ...store.policy.policy };
  for (const field of lists) {
    const v = b.optStrList(field);
    if (v) next[field] = v;
  }
  for (const field of ["allow_destructive_actions", "allow_financial_actions"] as const) {
    const v = b.optBool(field);
    if (v !== null) next[field] = v;
  }
  if (b.has("approval_ttl_seconds"))
    next.approval_ttl_seconds = b.optNum("approval_ttl_seconds", { int: true, min: 60, max: 30 * 24 * 3600 });
  if (b.has("max_concurrent_tasks"))
    next.max_concurrent_tasks = b.optNum("max_concurrent_tasks", { int: true, min: 1, max: 1000 });
  const extra = b.optObj("extra");
  if (extra) next.extra = extra;
  b.done();
  store.policy = { policy: next, version: store.policy.version + 1 };
  store.audit(
    {
      category: "admin",
      action: "organization.policy.update",
      resource_type: "organization",
      resource_id: store.org.id,
      metadata: { policy_version: store.policy.version },
    },
    ctx.requestId,
  );
  return json(ctx, 200, { policy: clone(next), policy_version: store.policy.version });
}

async function addMember(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "members:manage");
  const b = new Body(await ctx.json());
  const email = b.email("email");
  const role = b.optEnum("role", ROLES) ?? "member";
  b.done();
  if (store.members.some((m) => m.email === email)) throw conflict("This person is already a member", "already_member");
  const plan = PLANS.find((p) => p.name === store.org.plan);
  if (plan && store.members.length >= plan.max_members)
    throw conflict(`Your plan allows ${plan.max_members} members.`, "member_limit_reached");
  const member: MemberOut = {
    id: uuid(),
    user_id: uuid(),
    email,
    display_name: null,
    role,
    status: "invited",
    created_at: store.nowIso(),
  };
  store.members.push(member);
  store.audit(
    {
      category: "admin",
      action: "member.add",
      resource_type: "membership",
      resource_id: member.id,
      metadata: { email, role },
    },
    ctx.requestId,
  );
  return json(ctx, 201, clone(member));
}

function findMember(ctx: Ctx, { store }: Srv): MemberOut {
  const member = store.members.find((m) => m.id === ctx.params.member_id);
  if (!member) throw notFound("Member not found");
  return member;
}

function ensureOwnerRemains(store: Srv["store"], member: MemberOut, nextRole: string | null) {
  const owners = store.members.filter((m) => m.role === "owner" && m.status === "active");
  if (member.role === "owner" && nextRole !== "owner" && owners.length <= 1) {
    throw conflict("An organization must keep at least one owner", "last_owner");
  }
}

async function updateMemberRole(ctx: Ctx, srv: Srv) {
  requirePermission(srv.store, "members:manage");
  const b = new Body(await ctx.json());
  const role = b.enumOf("role", ROLES);
  b.done();
  const member = findMember(ctx, srv);
  ensureOwnerRemains(srv.store, member, role);
  member.role = role;
  srv.store.audit(
    {
      category: "admin",
      action: "member.role_update",
      resource_type: "membership",
      resource_id: member.id,
      metadata: { role },
    },
    ctx.requestId,
  );
  return noContent(ctx);
}

function removeMember(ctx: Ctx, srv: Srv) {
  requirePermission(srv.store, "members:manage");
  const member = findMember(ctx, srv);
  ensureOwnerRemains(srv.store, member, null);
  srv.store.members = srv.store.members.filter((m) => m !== member);
  srv.store.audit(
    { category: "admin", action: "member.remove", resource_type: "membership", resource_id: member.id },
    ctx.requestId,
  );
  return noContent(ctx);
}

function usage(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "usage:read");
  const orgWide = queryBool(ctx, "org_wide") && can(store, "audit:read");
  const now = new Date(store.now());
  const periodStart = iso(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).slice(0, 10);
  const totals: Record<string, number> = {};
  const byDay: UsageSummary["by_day"] = [];
  let cost = 0;
  const factor = orgWide ? 2.6 : 1; // teammates' usage on top of yours
  for (const [date, kinds] of [...store.usage.byDay.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (date < periodStart) continue;
    for (const [kind, qty] of kinds) {
      const q = kind === "storage_bytes" ? qty : Math.round(qty * factor);
      totals[kind] = (totals[kind] ?? 0) + q;
      byDay.push({ date, kind, quantity: q });
    }
    cost += (store.usage.costByDay.get(date) ?? 0) * factor;
  }
  const plan = PLANS.find((p) => p.name === store.org.plan) ?? PLANS[0];
  const out: UsageSummary = {
    period_start: periodStart,
    scope: orgWide ? "organization" : "user",
    plan: plan.name,
    quotas: { ...plan.monthly_quotas },
    totals,
    cost_usd: Math.round(cost * 1e6) / 1e6,
    by_day: byDay,
  };
  return json(ctx, 200, out);
}

function audit(ctx: Ctx, { store }: Srv) {
  requirePermission(store, "audit:read");
  const action = ctx.query.get("action");
  const category = ctx.query.get("category");
  const taskId = queryUuid(ctx, "task_id");
  const userId = queryUuid(ctx, "user_id");
  const rows = store.auditLog.filter(
    (a) =>
      (!action || a.action === action || a.action.startsWith(`${action}.`)) &&
      (!category || a.category === category) &&
      (!taskId || a.task_id === taskId) &&
      (!userId || a.user_id === userId),
  );
  return json(ctx, 200, paginate(ctx, rows, clone));
}

function notificationOut(n: NotificationRec): NotificationOut {
  const { userId: _u, idemKey: _k, ...out } = n;
  void _u;
  void _k;
  return clone(out);
}

function notifications(ctx: Ctx, { store }: Srv) {
  const unreadOnly = queryBool(ctx, "unread_only");
  const rows = store.notifications.filter((n) => n.userId === store.me.id && (!unreadOnly || !n.read_at));
  return json(ctx, 200, paginate(ctx, rows, notificationOut));
}

function markRead(ctx: Ctx, { store }: Srv) {
  const n = store.notifications.find((x) => x.id === ctx.params.notification_id && x.userId === store.me.id);
  if (n && !n.read_at) n.read_at = store.nowIso();
  return noContent(ctx);
}

function markAllRead(ctx: Ctx, { store }: Srv) {
  for (const n of store.notifications) {
    if (n.userId === store.me.id && !n.read_at) n.read_at = store.nowIso();
  }
  return noContent(ctx);
}

export function workspaceRoutes(r: Router): void {
  const health = (ctx: Ctx) => json(ctx, 200, { status: "ok", mode: "demo" });
  r.add("GET", "/health", health, { public: true })
    .add(
      "GET",
      "/ready",
      (ctx) => json(ctx, 200, { status: "ready", mode: "demo", checks: { database: "simulated", redis: "simulated" } }),
      { public: true },
    )
    .add("GET", "/live", health, { public: true })
    .add("GET", "/users/me", me)
    .add("PATCH", "/users/me", updateMe)
    .unavailable("DELETE", "/users/me", "The demo account cannot be deleted.")
    .add("GET", "/users/me/organizations", (ctx, { store }) => json(ctx, 200, [clone(store.org)]))
    .unavailable("POST", "/organizations", "Creating organizations is not available in the demo.")
    .add("GET", "/organizations/current", (ctx, { store }) => json(ctx, 200, clone(store.org)))
    .add("PATCH", "/organizations/current", updateOrg)
    .add("GET", "/organizations/current/policy", (ctx, { store }) =>
      json(ctx, 200, { policy: clone(store.policy.policy), policy_version: store.policy.version }),
    )
    .add("PUT", "/organizations/current/policy", updatePolicy)
    .add("GET", "/organizations/current/members", (ctx, { store }) => json(ctx, 200, clone(store.members)))
    .add("POST", "/organizations/current/members", addMember)
    .add("PATCH", "/organizations/current/members/{member_id}", updateMemberRole)
    .add("DELETE", "/organizations/current/members/{member_id}", removeMember)
    .add("GET", "/billing/plans", (ctx) => json(ctx, 200, clone(PLANS)))
    .add("GET", "/billing/entitlements", (ctx, { store }) =>
      json(ctx, 200, {
        plan: clone(PLANS.find((p) => p.name === store.org.plan) ?? PLANS.find((p) => p.name === DEMO_PLAN)),
        billing_provider: "demo",
      }),
    )
    .add("GET", "/usage", usage)
    .add("GET", "/audit", audit)
    .add("GET", "/notifications", notifications)
    .add("POST", "/notifications/{notification_id}/read", markRead)
    .add("POST", "/notifications/read-all", markAllRead);
  for (const [method, path] of [
    ["GET", "/admin/system"],
    ["GET", "/admin/users"],
    ["PATCH", "/admin/users/{user_id}"],
    ["GET", "/admin/organizations"],
    ["PATCH", "/admin/organizations/{org_id}"],
    ["GET", "/admin/security-events"],
    ["GET", "/admin/tasks/{task_id}"],
    ["GET", "/admin/jobs/dead"],
    ["POST", "/admin/jobs/{job_id}/retry"],
    ["GET", "/admin/usage"],
    ["GET", "/admin/feature-flags"],
    ["PUT", "/admin/feature-flags"],
  ]) {
    r.unavailable(method, path, "Platform administration is not available in the demo.");
  }
  r.unavailable("POST", "/webhooks/{provider}", "Webhooks are not available in the demo.");
}
