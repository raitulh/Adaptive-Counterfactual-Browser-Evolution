import {
  CheckIcon,
  HandIcon,
  RotateCcwIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel, Section, SectionHeader } from "../primitives";

const PRINCIPLE = [
  { k: "LLM proposes", v: "A structured plan — never an action, never a permission.", tone: "text-fg" },
  { k: "Backend decides", v: "Validation, policy and approvals in deterministic code.", tone: "text-fg" },
  {
    k: "Tools execute",
    v: "Owned adapters with timeouts, rate limits and an idempotency ledger.",
    tone: "text-accent",
  },
  { k: "Verifier confirms", v: "Machine evidence from the real system, or it isn't done.", tone: "text-verify" },
];

function PillarHead({ icon: Icon, title, tone }: { icon: LucideIcon; title: string; tone: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={cn("flex size-8 items-center justify-center rounded-lg border", tone)} aria-hidden>
        <Icon className="size-4" />
      </span>
      <h3 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h3>
    </div>
  );
}

function PolicyVisual() {
  const rows = [
    { tool: "calendar.find_free_slots", decision: "allow", cls: "border-line-strong text-fg-muted" },
    { tool: "gmail.send", decision: "require approval", cls: "border-warning/35 text-warning" },
    { tool: "system.shell_exec", decision: "deny", cls: "border-danger/35 text-danger" },
  ];
  return (
    <ul className="flex flex-col gap-1.5 font-mono text-[11px]">
      {rows.map((r) => (
        <li
          key={r.tool}
          className="flex items-center justify-between gap-3 rounded-md border border-line bg-bg/40 px-2.5 py-1.5"
        >
          <span className="truncate text-fg-muted">{r.tool}</span>
          <span className={cn("shrink-0 rounded-full border px-2 py-px", r.cls)}>{r.decision}</span>
        </li>
      ))}
    </ul>
  );
}

function ApprovalVisual() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/[0.04] p-3">
      <p className="text-[13px] text-fg">Send e-mail “Meeting confirmation” to rahim@example.org</p>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[10.5px] text-fg-subtle">
        <span>
          hash <span className="text-fg-muted">sha256(tool + args)</span>
        </span>
        <span>
          ttl <span className="text-fg-muted">15 min</span>
        </span>
        <span>
          uses <span className="text-warning">1</span>
        </span>
      </p>
    </div>
  );
}

function VerificationVisual() {
  const fields = [
    ["title", "Meeting with Rahim"],
    ["start", "15:00"],
    ["attendees", "rahim@example.org"],
  ];
  return (
    <div className="rounded-lg border border-verify/25 bg-verify/[0.04] p-3 font-mono text-[11px]">
      <p className="mb-2 flex items-center justify-between text-fg-subtle">
        <span>read_back · calendar event</span>
        <span className="text-verify">passed</span>
      </p>
      <ul className="flex flex-col gap-1">
        {fields.map(([k, v]) => (
          <li key={k} className="flex items-center gap-2">
            <CheckIcon className="size-3 text-verify" aria-hidden />
            <span className="w-16 text-fg-subtle">{k}</span>
            <span className="truncate text-fg-muted">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AuditVisual() {
  const lines = ["task.create", "approval.requested", "approval.approved", "tool.executed", "task.completed"];
  return (
    <ol className="rounded-lg border border-line bg-bg/40 p-3 font-mono text-[11px]">
      {lines.map((l, i) => (
        <li key={l} className="flex gap-3 py-0.5">
          <span className="w-4 text-right text-fg-subtle">{i + 1}</span>
          <span className="text-fg-muted">{l}</span>
        </li>
      ))}
      <li className="mt-1.5 border-t border-line pt-1.5 text-[10.5px] text-fg-subtle">
        append-only · UPDATE / DELETE rejected
      </li>
    </ol>
  );
}

function RecoveryVisual() {
  const states = [
    { s: "timeout", c: "text-fg-muted" },
    { s: "reconcile", c: "text-recover" },
    { s: "found by Message-ID", c: "text-fg-muted" },
    { s: "verified", c: "text-verify" },
  ];
  return (
    <div className="rounded-lg border border-recover/25 bg-recover/[0.04] p-3">
      <p className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
        {states.map((x, i) => (
          <span key={x.s} className="flex items-center gap-1.5">
            <span className={x.c}>{x.s}</span>
            {i < states.length - 1 && <span className="text-fg-subtle">→</span>}
          </span>
        ))}
      </p>
      <p className="mt-2 text-xs text-fg-muted">Exactly one e-mail. No blind retry.</p>
    </div>
  );
}

const PILLARS = [
  {
    icon: SlidersHorizontalIcon,
    title: "Policy",
    tone: "border-line-strong bg-surface-2 text-fg-muted",
    body: "A pure policy engine decides allow, require approval or deny for every step — from roles, your organization's rules and each tool's risk. Model output is never an input to authorization.",
    visual: <PolicyVisual />,
  },
  {
    icon: HandIcon,
    title: "Approval",
    tone: "border-warning/35 bg-warning/10 text-warning",
    body: "High-risk actions wait for you. An approval is bound to the exact tool and arguments, expires, and is consumed exactly once — a changed recipient needs a new one.",
    visual: <ApprovalVisual />,
  },
  {
    icon: ShieldCheckIcon,
    title: "Verification",
    tone: "border-verify/35 bg-verify/10 text-verify",
    body: "Writes are read back from the provider and compared field by field. A verifier error is inconclusive — never a pass.",
    visual: <VerificationVisual />,
  },
  {
    icon: ScrollTextIcon,
    title: "Audit",
    tone: "border-line-strong bg-surface-2 text-fg-muted",
    body: "Every decision and effect is recorded in the same transaction as the change, in an append-only log the database itself protects.",
    visual: <AuditVisual />,
  },
  {
    icon: RotateCcwIcon,
    title: "Recovery",
    tone: "border-recover/35 bg-recover/10 text-recover",
    body: "Failures are classified and handled deterministically: retry reads, reconcile ambiguous writes against the provider, ask you when only you can know.",
    visual: <RecoveryVisual />,
  },
];

export function TrustSection() {
  return (
    <Section
      id="trust"
      aria-labelledby="trust-title"
      className="border-t border-line bg-[radial-gradient(40%_30%_at_85%_0%,rgb(169_155_255/0.07),transparent_70%)]"
    >
      <SectionHeader
        index="05"
        eyebrow="Trust & verification"
        title={<span id="trust-title">Autonomy you can audit.</span>}
        lede="AgentOS assumes model output, web pages, e-mails and third-party tools are untrusted. Authority lives in code you can inspect; results are proven against the systems they changed."
      />

      <ol
        className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4"
        aria-label="Operating principle"
      >
        {PRINCIPLE.map((p, i) => (
          <li key={p.k} className="flex flex-col gap-2 bg-surface-1 p-5">
            <span className="font-mono text-[10.5px] text-fg-subtle">0{i + 1}</span>
            <span className={cn("text-lg font-semibold tracking-tight", p.tone)}>{p.k}.</span>
            <span className="text-sm leading-relaxed text-fg-muted">{p.v}</span>
          </li>
        ))}
      </ol>

      <ul className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {PILLARS.map((p) => (
          <li key={p.title} data-reveal>
            <Panel className="flex h-full flex-col gap-4 p-5">
              <PillarHead icon={p.icon} title={p.title} tone={p.tone} />
              <p className="text-sm leading-relaxed text-fg-muted">{p.body}</p>
              <div className="mt-auto">{p.visual}</div>
            </Panel>
          </li>
        ))}
        <li className="md:col-span-2 lg:col-span-1" data-reveal>
          <Panel className="flex h-full flex-col justify-between gap-6 bg-gradient-to-br from-surface-2/80 to-surface-1/60 p-5">
            <p className="text-xl leading-snug font-semibold tracking-tight text-balance text-fg">
              “Completed” means every step has passing evidence and no external action is unconfirmed.
            </p>
            <p className="text-sm text-fg-muted">
              Otherwise the task stops in <span className="text-recover">needs confirmation</span> and asks you — it
              never reports work it cannot prove.
            </p>
          </Panel>
        </li>
      </ul>
    </Section>
  );
}
