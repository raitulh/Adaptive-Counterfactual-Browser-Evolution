import { ArrowRightIcon, PlayIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { CorePanel } from "@/components/marketing/core-panel";
import { FinalCta } from "@/components/marketing/home/closing-sections";
import { marketingMetadata } from "@/components/marketing/metadata";
import { DocSection, FactList, OnThisPage, PageHero } from "@/components/marketing/page-hero";
import { Container } from "@/components/marketing/primitives";
import { PermissionBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PermissionLevel } from "@/lib/api";
import { cn } from "@/lib/utils";

export const metadata: Metadata = marketingMetadata({
  title: "Product — the agent operating system",
  description:
    "How AgentOS turns a goal into verified work: a validated planner, a policy engine, action-bound approvals, owned tool adapters, read-back verification, deterministic recovery, memory, automations and a durable event log.",
  path: "/product",
});

const TOC = [
  { id: "lifecycle", label: "Lifecycle" },
  { id: "agents", label: "Agents & versions" },
  { id: "tools", label: "Tools & MCP" },
  { id: "memory", label: "Memory" },
  { id: "automations", label: "Automations" },
  { id: "observability", label: "Observability" },
];

const LIFECYCLE = [
  {
    phase: "Goal",
    tone: "text-accent",
    statuses: ["created"],
    body: "The goal and its context are stored durably; TASK_CREATED opens an ordered, gap-free event log.",
  },
  {
    phase: "Plan",
    tone: "text-accent",
    statuses: ["planning", "planned"],
    body: "A trust-labelled context (policy, memory with freshness, prior results, fenced-off untrusted content) goes to the model, which proposes a JSON plan with explicit data flow between steps.",
  },
  {
    phase: "Validate",
    tone: "text-accent",
    statuses: ["validating"],
    body: "Shape, dependency graph, registered tools, argument schemas, references and permissions are checked. Issues go back for a bounded number of repairs.",
  },
  {
    phase: "Approve",
    tone: "text-warning",
    statuses: ["waiting_approval", "waiting_input"],
    body: "The policy engine decides each step: allow, require approval or deny — re-evaluated at execution with the concrete arguments.",
  },
  {
    phase: "Execute",
    tone: "text-accent",
    statuses: ["queued", "running"],
    body: "A worker leases the task. Parallel-safe reads run concurrently; side effects run one at a time and are registered in an idempotency ledger before they happen.",
  },
  {
    phase: "Verify",
    tone: "text-verify",
    statuses: ["verifying"],
    body: "A step completes only with machine evidence: read-back, provider confirmation, output-schema validation, or your confirmation.",
  },
  {
    phase: "Recover",
    tone: "text-recover",
    statuses: ["recovering", "requires_reconciliation", "blocked"],
    body: "Failures are classified; recovery retries, reconciles, re-plans, blocks or asks you — deterministically, with every decision recorded.",
  },
  {
    phase: "Complete",
    tone: "text-success",
    statuses: ["completed", "failed", "cancelled"],
    body: "Final verification: every step passed and no external action is pending. The summary is built from durable state — never written by a model.",
  },
  {
    phase: "Learn",
    tone: "text-accent",
    statuses: ["memory.extract", "acbe"],
    body: "Completed work can produce memories; verified failures feed controlled self-improvement.",
  },
];

const PERMISSIONS: Array<{ level: PermissionLevel; rule: string }> = [
  { level: "read", rule: "Runs without approval; results validated against the tool's output schema." },
  { level: "write", rule: "Allowed or approval-gated by policy; argument-dependent risk can escalate it." },
  { level: "high_risk_write", rule: "Sends or shares on your behalf — always requires approval." },
  { level: "destructive", rule: "Needs explicit organization opt-in and approval." },
  { level: "financial", rule: "Needs explicit organization opt-in and approval." },
  { level: "admin", rule: "Never available to agents." },
];

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title={
          <>
            The system behind
            <span className="block text-fg-muted">every goal.</span>
          </>
        }
        lede="AgentOS is a complete execution system for AI: versioned agents, a validated planner, a policy engine, owned tool adapters, verifiers, recovery, memory, automations and a durable event log — so every goal ends in a result you can check."
        actions={
          <>
            <Button asChild variant="primary" size="lg">
              <Link href="/signup">
                Start building <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link href="/#demo">
                <PlayIcon aria-hidden /> Watch a simulated run
              </Link>
            </Button>
          </>
        }
        visual={<CorePanel stage="idle" />}
      />

      <Container className="grid gap-12 py-20 md:py-28 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-16">
        <aside className="hidden lg:block">
          <OnThisPage items={TOC} className="sticky top-28" />
        </aside>
        <div className="flex min-w-0 flex-col gap-16">
          <DocSection
            id="lifecycle"
            index="01"
            title="One lifecycle, enforced in code."
            lede="Only the transitions defined in the task state machine are legal. The model proposes; everything after that is deterministic."
          >
            <ol className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {LIFECYCLE.map((l, i) => (
                <li
                  key={l.phase}
                  className="grid gap-3 bg-surface-1 p-5 md:grid-cols-[150px_minmax(0,1fr)_220px] md:items-baseline"
                >
                  <p className="flex items-baseline gap-3">
                    <span className="font-mono text-[10.5px] text-fg-subtle">{String(i + 1).padStart(2, "0")}</span>
                    <span className={cn("font-mono text-xs tracking-[0.18em] uppercase", l.tone)}>{l.phase}</span>
                  </p>
                  <p className="text-sm leading-relaxed text-fg-muted">{l.body}</p>
                  <p className="flex flex-wrap gap-1.5 md:justify-end">
                    {l.statuses.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-line px-1.5 py-px font-mono text-[10.5px] text-fg-subtle"
                      >
                        {s}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ol>
          </DocSection>

          <DocSection
            id="agents"
            index="02"
            title="Agents with immutable versions."
            lede="An agent is a named configuration; every change creates a new version. Tasks record exactly what produced them."
          >
            <FactList
              items={[
                {
                  term: "Instructions & policies",
                  body: "Each version pins its instructions, model policy, tool allow/deny lists and memory policy.",
                },
                {
                  term: "Execution limits",
                  body: "Caps on plan steps, tool and model calls, browser actions, duration, cost and re-plans. Exceeding one fails truthfully.",
                },
                {
                  term: "Reproducibility",
                  body: "Every task keeps the agent version, model, tool versions (e.g. calendar.create_event:v1), policy and strategy versions it ran with.",
                },
                {
                  term: "Safe defaults",
                  body: "The model's own risk labels can only make a plan stricter — never relax a decision made in code.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="tools"
            index="03"
            title="Tools with contracts, not prompts."
            lede="Every tool — built-in or MCP — declares input and output schemas, a permission level, risk, timeout, parallel safety and how its result is verified."
          >
            <ul className="flex flex-col gap-px overflow-hidden rounded-2xl border border-line bg-line">
              {PERMISSIONS.map((p) => (
                <li
                  key={p.level}
                  className="flex flex-col gap-2 bg-surface-1 px-5 py-4 sm:flex-row sm:items-center sm:gap-5"
                >
                  <span className="w-40 shrink-0">
                    <PermissionBadge level={p.level} />
                  </span>
                  <span className="text-sm text-fg-muted">{p.rule}</span>
                </li>
              ))}
            </ul>
            <FactList
              className="mt-4"
              items={[
                {
                  term: "Built-in adapters",
                  body: "Gmail, Google Calendar, Drive and Contacts; web fetch and web search with citations; document search; files; memory; an isolated browser.",
                },
                {
                  term: "Argument-aware risk",
                  body: "Tools can escalate by argument — inviting someone outside your organization turns a calendar write into a high-risk, approval-gated action.",
                },
                {
                  term: "MCP gateway",
                  body: "Admins register and approve servers, enable tools one by one and set permission and risk. Server annotations can only escalate.",
                },
                {
                  term: "Rug-pull protection",
                  body: "A changed tool schema or description disables that tool until it is reviewed again. MCP output is always treated as untrusted data.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="memory"
            index="04"
            title="Memory with confidence and freshness."
            lede="Multi-layer memory the planner can rely on — because it knows how much to rely on it."
          >
            <FactList
              items={[
                {
                  term: "Typed memories",
                  body: "Preferences, contacts, verified facts, semantic knowledge, task history and conversational context.",
                },
                { term: "Hybrid retrieval", body: "Keyword and vector search weighted by recency and importance." },
                {
                  term: "Freshness labels",
                  body: "Memories are fresh, stale or unverified — and reach the planner labelled that way, as data rather than instructions.",
                },
                {
                  term: "Conflicts, not overwrites",
                  body: "Values for the same subject are compared; a more trusted value supersedes the old one, a less trusted one is marked conflicted.",
                },
                {
                  term: "Extraction",
                  body: "When an agent's memory policy allows, completed tasks yield new memories automatically.",
                },
                {
                  term: "Your control",
                  body: "List, search, add, re-affirm and delete memories; deleted memories never regain derived data.",
                },
              ]}
            />
          </DocSection>

          <DocSection
            id="automations"
            index="05"
            title="Automations that stay accountable."
            lede="A cron schedule, a time zone and a task template. Each run is a normal task with the full lifecycle."
          >
            <FactList
              items={[
                {
                  term: "Schedules in your time zone",
                  body: "Standard cron expressions, optional run limits, and run-now for testing.",
                },
                {
                  term: "Failure policy",
                  body: "Pause after a number of consecutive failures (three by default) instead of failing silently forever.",
                },
                {
                  term: "Same guarantees",
                  body: "Scheduled work still passes policy, waits for approvals and is verified before it counts.",
                },
                { term: "History", body: "Every run links to its task: timeline, summary and audit trail." },
              ]}
            />
          </DocSection>

          <DocSection
            id="observability"
            index="06"
            title="Observable by design."
            lede="What happened, what changed, what was verified and what is waiting on you — always from durable state."
          >
            <FactList
              items={[
                {
                  term: "Live task timeline",
                  body: "Server-Sent Events with resumable sequence numbers; reconnects continue without gaps or duplicates.",
                },
                {
                  term: "Ordered event log",
                  body: "Every state change is an immutable event written in the same transaction as the change itself.",
                },
                {
                  term: "Deterministic summaries",
                  body: "Headline, what happened, what changed (with external references), what was verified, what failed, what is waiting.",
                },
                {
                  term: "Audit & usage",
                  body: "An append-only audit log and metered usage against your plan's quotas.",
                },
                {
                  term: "Operator telemetry",
                  body: "Request IDs on every response, OpenTelemetry traces and Prometheus metrics.",
                },
                {
                  term: "Developer mode",
                  body: "Reveal ids, sequences, tool versions and raw event payloads when you need them.",
                },
              ]}
            />
          </DocSection>
        </div>
      </Container>
      <FinalCta />
    </>
  );
}
