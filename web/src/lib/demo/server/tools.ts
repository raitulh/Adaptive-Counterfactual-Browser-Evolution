/**
 * Simulated tools, permission engine and recovery planner — small ports of
 * `backend/app/tools/builtin/*`, `app/permissions/service.py` and `app/recovery/service.py`, running
 * against the demo's simulated Google Workspace (calendar, contacts, mailbox) held in the store.
 */
import type { ErrorClass, OrganizationPolicy, PermissionLevel, RiskLevel } from "@/lib/api";
import { CONTACTS, INBOX } from "../fixtures/workspace";
import { DISABLED_FLAGS, IMPLIED_SCOPES, SCOPES, TOOL_CATALOGUE, type ToolSpec } from "../fixtures/tools";
import type { DemoStore, StepRec, TaskRec } from "./store";
import { DAY, EMAIL_RE, hash64, localDate, matchesAny, random, uuid, zonedIso } from "./util";

export const TOOLS = new Map<string, ToolSpec>(TOOL_CATALOGUE.map((t) => [t.name, t]));

const LEVEL_RANK: Record<PermissionLevel, number> = {
  read: 0,
  write: 1,
  high_risk_write: 2,
  destructive: 3,
  financial: 4,
  admin: 5,
};
const RISK_RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export const hasSideEffects = (level: PermissionLevel) => level !== "read";

export class ToolFailure extends Error {
  constructor(
    readonly errorClass: ErrorClass,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
    readonly question: string | null = null,
  ) {
    super(message);
  }
}

export interface ToolResult {
  output: Record<string, unknown>;
  summary: string;
  externalRef?: string | null;
  untrusted?: boolean;
}

export interface Assessment {
  permission_level: PermissionLevel;
  risk_level: RiskLevel;
  requires_approval: boolean;
  reasons: string[];
}

export interface ExecCtx {
  store: DemoStore;
  task: TaskRec;
  step: StepRec;
  timeZone: string;
}

type Args = Record<string, unknown>;

interface ToolSim {
  /** Simulated provider latency range (ms). */
  latency: [number, number];
  assess?(args: Args, policy: OrganizationPolicy): Assessment;
  describe?(args: Args): string;
  target?(args: Args): string | null;
  execute(ctx: ExecCtx, args: Args): ToolResult;
  fromUserInput?(args: Args, answer: string): ToolResult;
}

// ---------------------------------------------------------------------------- simulated Google Workspace
function requireScopes(store: DemoStore, required: string[]): void {
  const conn = store.connections.find((c) => c.provider === "google");
  if (!conn || conn.status !== "connected") {
    throw new ToolFailure("auth_expired", "integration_not_connected", "The required account is not connected.", {
      provider: "google",
    });
  }
  const granted = new Set(conn.scopes ?? []);
  for (const s of conn.scopes ?? []) for (const implied of IMPLIED_SCOPES[s] ?? []) granted.add(implied);
  const missing = required.filter((s) => !granted.has(s));
  if (missing.length) {
    throw new ToolFailure(
      "permission_denied",
      "insufficient_scope",
      "The connected account did not grant the permissions this action needs.",
      { provider: "google", missing_scopes: missing },
    );
  }
}

const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v ? [String(v)] : []);

function externalRecipients(addresses: string[], policy: OrganizationPolicy): string[] {
  const internal = new Set((policy.internal_email_domains ?? []).map((d) => d.toLowerCase()));
  return addresses.filter((a) => !internal.has(a.split("@").pop()!.toLowerCase()));
}

function resolveDate(value: unknown, timeZone: string, now: number): string {
  const v = String(value ?? "today").toLowerCase();
  if (v === "today") return localDate(timeZone, now);
  if (v === "tomorrow") return localDate(timeZone, now, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  throw new ToolFailure("invalid_input", "tool_input_invalid", "date must be YYYY-MM-DD, 'today' or 'tomorrow'");
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (value: unknown, def: string) => {
  const [h, m] = String(value ?? def)
    .split(":")
    .map(Number);
  return (h || 0) * 60 + (m || 0);
};
const shortId = (seed: string, n = 20) => hash64(seed + uuid()).slice(0, n);

const SIMS: Record<string, ToolSim> = {
  "calendar.find_free_slots": {
    latency: [700, 1500],
    execute(ctx, args) {
      requireScopes(ctx.store, [SCOPES.calendarRead]);
      if (ctx.task.sim.flakyFailures > 0) {
        ctx.task.sim.flakyFailures -= 1;
        throw new ToolFailure(
          "transient",
          "integration_temporarily_unavailable",
          "The external service is temporarily unavailable.",
          {
            provider: "google",
            upstream_status: 503,
          },
        );
      }
      const now = ctx.store.now();
      const date = resolveDate(args.date, ctx.timeZone, now);
      const duration = Math.max(5, Number(args.duration_minutes ?? 30));
      const start = toMinutes(args.earliest_time, "09:00");
      const end = toMinutes(args.latest_time, "18:00");
      const at = (m: number) => zonedIso(ctx.timeZone, date, hhmm(m));
      // Busy: the standing 14:00–15:00 block tomorrow (as in the simulated backend) + created events.
      const busy: [number, number][] = [];
      if (date === localDate(ctx.timeZone, now, 1)) busy.push([Date.parse(at(14 * 60)), Date.parse(at(15 * 60))]);
      for (const ev of ctx.store.calendar) busy.push([Date.parse(ev.start), Date.parse(ev.end)]);
      const slots: { start: string; end: string }[] = [];
      for (let m = start; m + duration <= end && slots.length < 8; m += 30) {
        const s = Date.parse(at(m));
        const e = Date.parse(at(m + duration));
        if (e <= now) continue;
        if (busy.some(([bs, be]) => s < be && e > bs)) continue;
        slots.push({ start: at(m), end: at(m + duration) });
      }
      const dayBusy = busy.filter(([bs]) => bs >= Date.parse(at(0)) && bs < Date.parse(at(0)) + DAY).length;
      return {
        output: {
          slots,
          date,
          timezone: ctx.timeZone,
          window_start: at(start),
          window_end: at(end),
          busy_count: dayBusy,
        },
        summary: `Found ${slots.length} free ${duration}-minute slot(s) on ${date}`,
      };
    },
  },

  "contacts.lookup": {
    latency: [400, 900],
    execute(ctx, args) {
      const name = String(args.name ?? "").trim();
      const first = name.split(/\s+/)[0]?.toLowerCase() ?? "";
      const checked: string[] = ["saved_contacts"];
      const found = new Map<string, { name: string; email: string; source: string; confidence: number }>();
      for (const m of ctx.store.memories) {
        if (m.memory_type !== "contact" || m.status !== "active" || m.confidence < 0.5) continue;
        if (m.subject_key !== `contact:${first}:email`) continue;
        const email = m.content.match(/[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}/i)?.[0]?.toLowerCase();
        if (email) found.set(email, { name, email, source: "saved_contact", confidence: m.confidence });
      }
      if (ctx.store.googleScopes().has(SCOPES.contactsRead)) {
        checked.push("google_contacts");
        for (const c of CONTACTS) {
          const full = c.name.toLowerCase();
          if (full === name.toLowerCase() || full.split(" ")[0] === first) {
            const prev = found.get(c.email);
            if (!prev || prev.confidence < 0.9)
              found.set(c.email, { name: c.name, email: c.email, source: "google_contacts", confidence: 0.9 });
          }
        }
      }
      const unique = [...found.values()].sort((a, b) => b.confidence - a.confidence);
      if (unique.length === 0) {
        const q = `I couldn't find an e-mail address for “${name}” in your contacts. What is their e-mail address?`;
        throw new ToolFailure(
          "needs_user_input",
          "needs_user_input",
          q,
          { field: "email", name, sources_checked: checked },
          q,
        );
      }
      if (unique.length > 1) {
        const q = `I found several contacts matching “${name}”: ${unique.map((m) => `${m.name} <${m.email}>`).join(", ")}. Which one?`;
        throw new ToolFailure(
          "needs_user_input",
          "needs_user_input",
          q,
          { field: "email", options: unique.map((m) => m.email) },
          q,
        );
      }
      const best = unique[0];
      return {
        output: { query: name, matches: unique, best, sources_checked: checked },
        summary: `Resolved “${name}” to ${best.email} (${best.source})`,
      };
    },
    fromUserInput(args, answer) {
      const email = answer.trim().replace(/^<|>$/g, "").toLowerCase();
      if (!EMAIL_RE.test(email))
        throw new ToolFailure("invalid_input", "validation_failed", "Please provide a valid e-mail address", {
          field: "email",
        });
      const name = String(args.name ?? "");
      const match = { name, email, source: "user_provided", confidence: 1.0 };
      return {
        output: { query: name, matches: [match], best: match, sources_checked: ["user"] },
        summary: `Using ${email} for “${name}” (provided by you)`,
      };
    },
  },

  "calendar.create_event": {
    latency: [900, 1800],
    assess(args, policy) {
      const attendees = list(args.attendees);
      const reasons: string[] = [];
      let risk: RiskLevel = "medium";
      if (attendees.length) {
        reasons.push("sends invitations to other people");
        if (externalRecipients(attendees, policy).length) {
          risk = "high";
          reasons.push("attendees outside the organization");
        }
      }
      return { permission_level: "write", risk_level: risk, requires_approval: attendees.length > 0, reasons };
    },
    describe(args) {
      const attendees = list(args.attendees);
      const who = attendees.length ? ` with ${attendees.join(", ")}` : "";
      return `Create calendar event “${String(args.summary)}” from ${String(args.start)} to ${String(args.end)}${who}`;
    },
    target: (args) => `calendar:${String(args.calendar_id ?? "primary")}`,
    execute(ctx, args) {
      requireScopes(ctx.store, [SCOPES.calendarWrite]);
      const event = {
        id: `agentos${shortId(String(args.summary), 18)}`,
        summary: String(args.summary),
        start: String(args.start),
        end: String(args.end),
        attendees: list(args.attendees),
      };
      ctx.store.calendar.push(event);
      return {
        output: { event_id: event.id, html_link: null, ...event, status: "confirmed", already_existed: false },
        externalRef: event.id,
        summary: `Created calendar event “${event.summary}” at ${event.start}`,
      };
    },
  },

  "gmail.send": {
    latency: [800, 1600],
    assess(args, policy) {
      const recipients = [...list(args.to), ...list(args.cc)];
      const external = externalRecipients(recipients, policy);
      const reasons: string[] = [];
      let risk: RiskLevel = "medium";
      if (external.length) {
        risk = "high";
        reasons.push(`${external.length} recipient(s) outside the organization`);
      }
      if (recipients.length > 20) {
        risk = "critical";
        reasons.push("more than 20 recipients");
      }
      return { permission_level: "high_risk_write", risk_level: risk, requires_approval: true, reasons };
    },
    describe: (args) => `Send e-mail “${String(args.subject)}” to ${list(args.to).join(", ")}`,
    target: (args) => list(args.to).join(","),
    execute(ctx, args) {
      requireScopes(ctx.store, [SCOPES.gmailSend]);
      const id = shortId(String(args.subject), 16);
      const to = list(args.to);
      ctx.store.sentMail.push({
        id,
        to,
        subject: String(args.subject),
        body: String(args.body ?? ""),
        draft: false,
        at: ctx.store.nowIso(),
      });
      return {
        output: {
          message_id: id,
          thread_id: id,
          label_ids: ["SENT"],
          message_id_header: `<${hash64(id).slice(0, 40)}@agentos.mail>`,
          to,
          subject: String(args.subject),
          reconciled: false,
        },
        externalRef: id,
        summary: `Sent e-mail “${String(args.subject)}” to ${to.join(", ")}`,
      };
    },
  },

  "gmail.create_draft": {
    latency: [600, 1200],
    describe: (args) => `Draft e-mail “${String(args.subject)}” to ${list(args.to).join(", ")}`,
    target: (args) => list(args.to).join(","),
    execute(ctx, args) {
      requireScopes(ctx.store, [SCOPES.gmailCompose]);
      const id = `r${Math.floor(random() * 9e15)}`;
      ctx.store.sentMail.push({
        id,
        to: list(args.to),
        subject: String(args.subject),
        body: String(args.body ?? ""),
        draft: true,
        at: ctx.store.nowIso(),
      });
      return {
        output: {
          draft_id: id,
          message_id: shortId(id, 16),
          message_id_header: `<${hash64(id).slice(0, 40)}@agentos.mail>`,
          subject: String(args.subject),
        },
        externalRef: id,
        summary: `Created draft “${String(args.subject)}”`,
      };
    },
  },

  "gmail.search": {
    latency: [700, 1400],
    execute(ctx, args) {
      requireScopes(ctx.store, [SCOPES.gmailRead]);
      const now = ctx.store.now();
      const max = Math.min(50, Number(args.max_results ?? 20));
      const unreadOnly = String(args.query ?? "").includes("is:unread");
      const messages = INBOX.filter((m) => !unreadOnly || m.unread)
        .filter((m) => m.minutesAgo < 24 * 60)
        .slice(0, max)
        .map(({ minutesAgo, ...m }) => ({ ...m, date: new Date(now - minutesAgo * 60_000).toISOString() }));
      return {
        output: { messages, query: String(args.query ?? "") },
        summary: `Found ${messages.length} e-mail(s)`,
        untrusted: true,
      };
    },
  },

  "memory.save": {
    latency: [300, 700],
    describe: (args) => `Remember (${String(args.memory_type ?? "long_term")}): ${String(args.content).slice(0, 120)}`,
    execute(ctx, args) {
      const store = ctx.store;
      const now = store.nowIso();
      const type = String(args.memory_type ?? "long_term");
      const id = uuid();
      store.memories.push({
        id,
        userId: ctx.task.userId,
        content: String(args.content),
        memory_type: type,
        subject_key: (args.subject_key as string | undefined) ?? null,
        confidence: 0.9,
        importance: Number(args.importance ?? 0.7),
        source_type: "task",
        source_reference: `task:${ctx.task.id}`,
        status: "active",
        superseded_by: null,
        created_at: now,
        updated_at: now,
        last_verified_at: now,
        expires_at: null,
        last_accessed_at: null,
        access_count: 0,
      });
      store.audit({
        category: "memory",
        action: "memory.create",
        actor_type: "worker",
        resource_type: "memory",
        resource_id: id,
        task_id: ctx.task.id,
        metadata: { memory_type: type, status: "active" },
      });
      return {
        output: { memory_id: id, memory_type: type, status: "active" },
        externalRef: id,
        summary: `Saved memory (${type})`,
      };
    },
  },
};

export function toolSim(name: string): ToolSim | undefined {
  return SIMS[name];
}

export function describeAction(spec: ToolSpec, args: Args): string {
  return SIMS[spec.name]?.describe?.(args) ?? `${spec.description} (${spec.name})`;
}

export function toolTarget(spec: ToolSpec, args: Args): string | null {
  return SIMS[spec.name]?.target?.(args) ?? null;
}

export function assess(spec: ToolSpec, args: Args, policy: OrganizationPolicy): Assessment | null {
  return SIMS[spec.name]?.assess?.(args, policy) ?? null;
}

// ---------------------------------------------------------------------------- permission engine
export interface Decision {
  decision: "allow" | "deny" | "require_approval";
  level: PermissionLevel;
  risk: RiskLevel;
  reasons: string[];
}

export function evaluatePermission(
  store: DemoStore,
  spec: ToolSpec,
  opts: {
    assessment?: Assessment | null;
    toolPolicy?: { allowed?: string[]; denied?: string[] };
    modelAsked?: boolean;
  } = {},
): Decision {
  let level = spec.permission_level;
  let risk = spec.risk_level;
  let needs = spec.requires_approval;
  const reasons: string[] = [];
  const a = opts.assessment;
  if (a) {
    if (LEVEL_RANK[a.permission_level] > LEVEL_RANK[level]) level = a.permission_level;
    if (RISK_RANK[a.risk_level] > RISK_RANK[risk]) risk = a.risk_level;
    needs = needs || a.requires_approval;
    reasons.push(...a.reasons);
  }
  const deny = (reason: string): Decision => ({ decision: "deny", level, risk, reasons: [...reasons, reason] });
  const policy = store.policy.policy;
  const role = store.me.role;
  if (!store.me.permissions.includes("tasks:create")) return deny("role may not run agent actions");
  if (level === "admin") return deny("administrative actions are not available to agents");
  if (spec.feature_flag && DISABLED_FLAGS.has(spec.feature_flag))
    return deny(`feature '${spec.feature_flag}' is disabled`);
  if (matchesAny(spec.name, policy.blocked_tools)) return deny("tool is blocked by organization policy");
  const toolPolicy = opts.toolPolicy ?? {};
  if (!matchesAny(spec.name, toolPolicy.allowed ?? ["*"]) || matchesAny(spec.name, toolPolicy.denied)) {
    return deny("tool is not allowed for this agent");
  }
  if (level === "destructive") {
    if (!policy.allow_destructive_actions) return deny("destructive actions are disabled by organization policy");
    needs = true;
    reasons.push("destructive action");
  }
  if (level === "financial") {
    if (!policy.allow_financial_actions) return deny("financial actions are disabled by organization policy");
    needs = true;
    reasons.push("financial action");
  }
  if (level === "high_risk_write") needs = true;
  if (hasSideEffects(level) && RISK_RANK[risk] >= RISK_RANK.high) {
    needs = true;
    reasons.push(`${risk} risk`);
  }
  const rules = store.toolRules
    .filter((r) => matchesAny(spec.name, [r.tool_pattern]) && (!r.role || r.role === role))
    .sort((x, y) => Number(!x.role) - Number(!y.role) || Number(x.effect !== "deny") - Number(y.effect !== "deny"));
  for (const r of rules)
    if (r.effect === "deny") return deny(r.reason || `denied by organization rule '${r.tool_pattern}'`);
  if (rules.some((r) => r.effect === "require_approval") || matchesAny(spec.name, policy.always_require_approval)) {
    needs = true;
    reasons.push("organization requires approval for this tool");
  } else if (rules.some((r) => r.effect === "allow") && needs) {
    const bounded = (level === "write" || level === "high_risk_write") && RISK_RANK[risk] <= RISK_RANK.medium;
    if (bounded && !opts.modelAsked) {
      needs = false;
      reasons.push("approval waived by organization rule");
    }
  }
  if (opts.modelAsked && hasSideEffects(level)) needs = true;
  return { decision: needs ? "require_approval" : "allow", level, risk, reasons: [...new Set(reasons)] };
}

// ---------------------------------------------------------------------------- recovery planner
export interface RecoveryDecision {
  action: "retry" | "reconcile" | "repair" | "request_user" | "block" | "fail";
  reason: string;
  delaySeconds: number;
  question: string | null;
}

const RETRYABLE = new Set<ErrorClass>(["transient", "timeout", "rate_limited", "network_error"]);

export function decideRecovery(failure: ToolFailure, spec: ToolSpec, attempt: number): RecoveryDecision {
  const cls = failure.errorClass;
  const writes = hasSideEffects(spec.permission_level);
  const make = (
    action: RecoveryDecision["action"],
    reason: string,
    delaySeconds = 0,
    question: string | null = null,
  ) => ({
    action,
    reason,
    delaySeconds,
    question,
  });
  if (cls === "needs_user_input") return make("request_user", failure.message, 0, failure.question ?? failure.message);
  if (cls === "auth_expired") return make("block", "the connected account must be reconnected");
  if (cls === "permission_denied") return make("block", "additional permission (scope) is required");
  if (cls === "policy_blocked") return make("fail", "blocked by policy");
  if (RETRYABLE.has(cls) || cls === "model_error") {
    if (attempt < spec.max_attempts) {
      const base = Math.min(60, spec.base_delay_seconds * 2 ** Math.max(0, attempt - 1));
      const delay = base * (1 + (random() * 0.6 - 0.3));
      return make("retry", `${cls}; retrying with backoff`, Math.round(delay * 100) / 100);
    }
    return make("fail", `${cls}; retries exhausted`);
  }
  if (!writes && attempt < Math.min(2, spec.max_attempts))
    return make("retry", "unexpected error on a read; retrying once", spec.base_delay_seconds);
  return make("fail", `unrecoverable error (${failure.code})`);
}
