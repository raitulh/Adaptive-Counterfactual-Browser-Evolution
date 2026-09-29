/**
 * Memory, automations, MCP and self-improvement (ACBE) — each with a small, faithful product vignette.
 */
import { ArrowRightIcon, BlocksIcon, CalendarClockIcon, CheckIcon, PauseIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Section, SectionHeader } from "../primitives";

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="mt-8 flex flex-col gap-3 text-[15px] text-fg-muted">
      {items.map((i) => (
        <li key={i} className="flex gap-3">
          <span className="mt-2.5 h-px w-3 shrink-0 bg-accent" aria-hidden />
          <span className="leading-relaxed">{i}</span>
        </li>
      ))}
    </ul>
  );
}

/* ────────────────────────────── Memory ────────────────────────────── */

const MEMORIES = [
  { type: "preference", content: "Prefers meetings after 2 PM", conf: 0.92, fresh: "fresh" },
  { type: "contact", content: "Rahim Chowdhury — rahim@example.org", conf: 0.88, fresh: "fresh" },
  { type: "verified_fact", content: "Team standup is Mondays at 09:30", conf: 0.97, fresh: "fresh" },
  { type: "task_history", content: "Q3 report is in Drive › Finance", conf: 0.54, fresh: "stale" },
] as const;

function MemoryVisual() {
  return (
    <Panel className="p-2">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">Memory</p>
        <p className="font-mono text-[10.5px] text-fg-subtle">hybrid retrieval · keyword + vector</p>
      </div>
      <ul className="flex flex-col gap-1">
        {MEMORIES.map((m) => (
          <li
            key={m.content}
            className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-bg/40 px-3.5 py-3"
          >
            <div className="min-w-0">
              <p className="font-mono text-[10.5px] text-fg-subtle">{m.type}</p>
              <p className="mt-0.5 truncate text-sm text-fg">{m.content}</p>
            </div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-[10.5px]",
                m.fresh === "fresh" ? "border-line-strong text-fg-muted" : "border-recover/35 text-recover",
              )}
            >
              {m.fresh}
            </span>
            <div className="col-span-2 flex items-center gap-3">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
                <span
                  className={cn(
                    "block h-full rounded-full",
                    m.type === "verified_fact" ? "bg-verify" : m.conf > 0.7 ? "bg-accent" : "bg-fg-subtle",
                  )}
                  style={{ width: `${m.conf * 100}%` }}
                />
              </span>
              <span className="w-24 text-right font-mono text-[10.5px] text-fg-subtle">
                confidence {m.conf.toFixed(2)}
              </span>
            </div>
            {m.fresh === "stale" && (
              <p className="col-span-2 font-mono text-[10.5px] text-recover/90">
                planner sees: “stale — verify before relying on it”
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function MemorySection() {
  return (
    <Section id="memory" aria-labelledby="memory-title" className="border-t border-line">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHeader
            index="06"
            eyebrow="Memory"
            title={<span id="memory-title">Memory that knows how sure it is.</span>}
            lede="AgentOS remembers preferences, contacts, verified facts and task history — each with a confidence score and a freshness label, so the planner treats an old guess differently from a checked fact."
          />
          <Bullets
            items={[
              "Conflicting values are detected by subject; the more trusted one supersedes the other instead of silently overwriting it.",
              "Stale or unverified memories reach the planner labelled as such — never as instructions.",
              "You can list, add, re-affirm and delete memories; a deleted memory never regains derived data.",
            ]}
          />
        </div>
        <div data-reveal>
          <MemoryVisual />
        </div>
      </div>
    </Section>
  );
}

/* ────────────────────────────── Automations ────────────────────────────── */

function AutomationVisual() {
  const runs = [
    { when: "Mon 08:45", status: "Completed", note: "verified", tone: "text-success", icon: CheckIcon },
    { when: "Mon 08:45 · last week", status: "Completed", note: "verified", tone: "text-success", icon: CheckIcon },
    {
      when: "Mon 08:45 · 2 weeks ago",
      status: "Needs approval",
      note: "waited for you",
      tone: "text-warning",
      icon: PauseIcon,
    },
  ];
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line p-5">
        <span
          className="flex size-9 items-center justify-center rounded-lg border border-accent/30 bg-accent/10 text-accent"
          aria-hidden
        >
          <CalendarClockIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">Weekly pipeline digest</p>
          <p className="mt-1 text-sm text-fg-muted">
            “Summarize last week&apos;s deal e-mails and send the digest to the sales team.”
          </p>
        </div>
        <span className="rounded-full border border-success/30 px-2 py-0.5 text-xs text-success">Enabled</span>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-line text-sm sm:grid-cols-3">
        {[
          [
            "Schedule",
            <span key="s" className="font-mono text-xs">
              45 8 * * 1
            </span>,
          ],
          ["Runs", "Mondays 08:45 · Asia/Dhaka"],
          ["On failure", "Pause after 3 in a row"],
        ].map(([k, v]) => (
          <div key={String(k)} className="bg-surface-1 px-5 py-3">
            <dt className="font-mono text-[10.5px] tracking-[0.16em] text-fg-subtle uppercase">{k}</dt>
            <dd className="mt-1 text-fg-muted">{v}</dd>
          </div>
        ))}
      </dl>
      <ol className="flex flex-col divide-y divide-line">
        {runs.map((r) => (
          <li key={r.when} className="flex items-center gap-3 px-5 py-3 text-sm">
            <r.icon className={cn("size-3.5", r.tone)} aria-hidden />
            <span className="text-fg-muted">{r.when}</span>
            <span className={cn("ml-auto", r.tone)}>{r.status}</span>
            <span className="hidden font-mono text-[10.5px] text-fg-subtle sm:inline">{r.note}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function AutomationsSection() {
  return (
    <Section id="automations" aria-labelledby="automations-title" className="border-t border-line">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div className="lg:order-2">
          <SectionHeader
            index="07"
            eyebrow="Automations"
            title={<span id="automations-title">Goals that run on a schedule.</span>}
            lede="Turn any goal into a cron-scheduled automation in your time zone. Every run is a full task — planned, policy-checked, approved when needed and verified — not a script that runs blind."
          />
          <Bullets
            items={[
              "The same approvals apply: a scheduled send still waits for you.",
              "Repeated failures pause the automation instead of failing silently every week.",
              "Every run keeps its own timeline, summary and audit trail.",
            ]}
          />
        </div>
        <div className="lg:order-1" data-reveal>
          <AutomationVisual />
        </div>
      </div>
    </Section>
  );
}

/* ────────────────────────────── MCP ────────────────────────────── */

function McpVisual() {
  const tools = [
    { name: "search_issues", level: "read", state: "Enabled", tone: "text-success" },
    { name: "create_issue", level: "write · approval", state: "Enabled", tone: "text-success" },
    {
      name: "update_issue",
      level: "write",
      state: "Schema changed — disabled until re-approved",
      tone: "text-warning",
    },
    { name: "delete_project", level: "destructive", state: "Not enabled", tone: "text-fg-subtle" },
  ];
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-line p-5">
        <span
          className="flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface-2 text-fg-muted"
          aria-hidden
        >
          <BlocksIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-fg">issue-tracker</p>
          <p className="truncate font-mono text-[11px] text-fg-subtle">https://mcp.example.com/sse</p>
        </div>
        <span className="rounded-full border border-success/30 px-2 py-0.5 text-xs text-success">
          Approved by admin
        </span>
      </div>
      <ul className="divide-y divide-line">
        {tools.map((t) => (
          <li key={t.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
            <span className="font-mono text-[13px] text-fg">{t.name}</span>
            <span className="rounded border border-line px-1.5 py-px font-mono text-[10.5px] text-fg-subtle">
              {t.level}
            </span>
            <span className={cn("ml-auto flex items-center gap-1.5 text-xs", t.tone)}>
              {t.tone === "text-warning" && <ShieldAlertIcon className="size-3.5" aria-hidden />}
              {t.state}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function McpSection() {
  return (
    <Section id="mcp" aria-labelledby="mcp-title" className="border-t border-line">
      <div className="grid items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHeader
            index="08"
            eyebrow="MCP ecosystem"
            title={<span id="mcp-title">Bring any tool. Keep every guarantee.</span>}
            lede="Connect Model Context Protocol servers per organization. They join the same pipeline as built-in tools — policy, approvals, egress controls, verification and audit."
          />
          <Bullets
            items={[
              "An admin approves each server, enables each tool and sets its permission and risk; server annotations can only make a tool stricter.",
              "If a tool's schema or description changes, it is disabled until someone reviews it again.",
              "MCP output is untrusted data: it can inform a plan, never authorize an action.",
            ]}
          />
        </div>
        <div data-reveal>
          <McpVisual />
        </div>
      </div>
    </Section>
  );
}

/* ────────────────────────────── ACBE ────────────────────────────── */

const ACBE_STAGES = [
  { k: "Verified failure", v: "Recurring in ≥ 3 real tasks within 7 days", tone: "border-line-strong text-fg-muted" },
  { k: "Candidate", v: "A bounded config change — never code", tone: "border-accent/35 text-accent" },
  {
    k: "Experiment",
    v: "Same cases vs. baseline; safety gate first, then significance",
    tone: "border-verify/35 text-verify",
  },
  { k: "Canary", v: "A person approves a 1–50 % rollout", tone: "border-warning/35 text-warning" },
  { k: "Promoted", v: "After ≥ 24 h, only if failures did not increase", tone: "border-success/35 text-success" },
];

export function AcbeSection() {
  return (
    <Section id="learn" aria-labelledby="acbe-title" className="border-t border-line">
      <SectionHeader
        index="09"
        eyebrow="Self-improving agents"
        title={<span id="acbe-title">Self-improving. Never self-promoting.</span>}
        lede="ACBE learns only from verified failures. It asks what bounded change would have avoided a recurring problem, proves the answer in controlled experiments, and lets a person roll it out gradually — and roll it back at any time."
      />
      <ol className="mt-14 grid gap-3 md:grid-cols-5" aria-label="Improvement pipeline">
        {ACBE_STAGES.map((s, i) => (
          <li key={s.k} className="relative" data-reveal>
            <Panel className="flex h-full flex-col gap-3 p-4">
              <span className="font-mono text-[10.5px] text-fg-subtle">0{i + 1}</span>
              <span className={cn("w-fit rounded-full border px-2.5 py-0.5 text-[13px] font-medium", s.tone)}>
                {s.k}
              </span>
              <span className="text-sm leading-relaxed text-fg-muted">{s.v}</span>
            </Panel>
            {i < ACBE_STAGES.length - 1 && (
              <ArrowRightIcon
                className="absolute top-1/2 -right-2.5 z-10 hidden size-4 -translate-y-1/2 text-fg-subtle md:block"
                aria-hidden
              />
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 grid gap-3 md:grid-cols-[2fr_1fr]">
        <Panel className="p-5">
          <p className="font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">Example candidate</p>
          <p className="mt-2 text-[15px] text-fg">
            <span className="font-mono text-sm text-accent">calendar.create_event</span> read-back failed while the
            provider was still catching up.
          </p>
          <p className="mt-2 font-mono text-xs text-fg-muted">
            patch → verification_readback.max_attempts +2 · base_delay ≥ 250 ms
          </p>
        </Panel>
        <Panel className="flex flex-col justify-center gap-2 border-recover/25 p-5">
          <p className="text-[15px] font-semibold text-recover">Rollback, any time</p>
          <p className="text-sm text-fg-muted">
            Removes the strategy from resolution immediately. Every transition is audited.
          </p>
        </Panel>
      </div>
    </Section>
  );
}
