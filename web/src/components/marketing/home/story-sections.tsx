/**
 * The pinned-visual chapters of the landing page: hero, "What is an AI agent OS?" and the
 * execution loop. Server components; `data-stage` markers drive the visual via <StoryStage>.
 */
import { ArrowDownIcon, ArrowRightIcon, MessageSquareIcon, MousePointerClickIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Container, Eyebrow, SectionHeader } from "../primitives";
import { LifecycleRail } from "../story/lifecycle-rail";
import { VerbSequence } from "../story/verb-sequence";

/** Emphasis for scroll-activated markers: dimmed once the story is live, full when active. */
const EMPHASIS =
  "transition-opacity duration-700 ease-out group-data-[ready=true]/story:opacity-30 data-[active=true]:opacity-100!";

/** Mobile: chapter text sits on a quiet card in the lower half so the core stays visible above. */
const MOBILE_CARD =
  "max-lg:rounded-2xl max-lg:border max-lg:border-line max-lg:bg-bg/80 max-lg:p-5 max-lg:backdrop-blur-md max-lg:shadow-float";

export function Hero() {
  return (
    <section id="top" data-stage="idle" aria-labelledby="hero-title" className="relative flex min-h-svh flex-col">
      <Container className="flex flex-1 flex-col justify-end pt-28 pb-10 lg:justify-center lg:pb-28">
        <div className="max-w-[44rem]">
          <Eyebrow className="motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in">
            The operating system for AI that acts
          </Eyebrow>
          <h1
            id="hero-title"
            className="mt-6 text-[clamp(2.6rem,6.4vw,5.5rem)] leading-[0.97] font-semibold tracking-[-0.048em] text-balance text-fg motion-safe:animate-in motion-safe:duration-1000 motion-safe:fade-in motion-safe:slide-in-from-bottom-3"
          >
            Give AI a goal.{" "}
            <span className="block bg-gradient-to-br from-fg-muted via-fg-muted to-fg-subtle bg-clip-text text-transparent">
              AgentOS gets the work done.
            </span>
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-pretty text-fg-muted motion-safe:animate-in motion-safe:duration-1000 motion-safe:fade-in md:text-lg">
            Plan, execute, verify, and improve real-world tasks across the tools you use.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3 motion-safe:animate-in motion-safe:duration-1000 motion-safe:fade-in">
            <Button asChild variant="primary" size="lg" className="h-12 px-6 text-[15px]">
              <Link href="/signup">
                Start building
                <ArrowRightIcon aria-hidden />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-12 bg-bg/40 px-6 text-[15px] backdrop-blur-sm">
              <a href="#system">
                Explore the system
                <ArrowDownIcon aria-hidden />
              </a>
            </Button>
          </div>
          <p className="mt-10 hidden font-mono text-2xs tracking-[0.12em] text-fg-subtle sm:block">
            LLM proposes <span className="px-1.5 text-line-strong">/</span> Backend decides{" "}
            <span className="px-1.5 text-line-strong">/</span> Tools execute{" "}
            <span className="px-1.5 text-line-strong">/</span> <span className="text-verify">Verifier confirms</span>
          </p>
        </div>
      </Container>
      <HeroReadouts />
    </section>
  );
}

const READOUTS = [
  { k: "Policy", v: "allow · require approval · deny", tone: "text-fg-muted" },
  { k: "Approvals", v: "bound · expiring · single-use", tone: "text-warning" },
  { k: "Verification", v: "read-back against the real system", tone: "text-verify" },
  { k: "Tenancy", v: "isolated · encrypted · audited", tone: "text-fg-muted" },
];

function HeroReadouts() {
  return (
    <Container className="hidden pb-8 lg:block">
      <dl className="grid grid-cols-4 border-t border-line">
        {READOUTS.map((r, i) => (
          <div key={r.k} className={cn("flex flex-col gap-1.5 pt-4 pr-6", i > 0 && "border-l border-line pl-6")}>
            <dt className="font-mono text-[10px] tracking-[0.22em] text-fg-subtle uppercase">{r.k}</dt>
            <dd className={cn("font-mono text-xs", r.tone)}>{r.v}</dd>
          </div>
        ))}
      </dl>
    </Container>
  );
}

/* ───────────────────────────── What is an AI agent OS? ───────────────────────────── */

function ClickTrail() {
  const steps = ["Open calendar", "Find a gap", "Create event", "Write e-mail", "Check it sent"];
  return (
    <ol className="mt-6 flex flex-wrap gap-2" aria-label="Manual steps">
      {steps.map((s) => (
        <li
          key={s}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-fg-muted"
        >
          <MousePointerClickIcon className="size-3.5 text-fg-subtle" aria-hidden />
          {s}
        </li>
      ))}
    </ol>
  );
}

function ChatSketch() {
  return (
    <div className="mt-6 flex max-w-md flex-col gap-2 text-sm" aria-label="Example conversation">
      <p className="ml-auto rounded-2xl rounded-br-md bg-surface-3 px-3.5 py-2 text-fg">When am I free tomorrow?</p>
      <p className="mr-8 rounded-2xl rounded-bl-md border border-line bg-surface-1 px-3.5 py-2 text-fg-muted">
        You look free after 3 PM. Want me to draft an invite you can send?
      </p>
      <p className="font-mono text-2xs text-fg-subtle">…and then you still do the work, and check it yourself.</p>
    </div>
  );
}

const VERBS = [
  { label: "understands" },
  { label: "plans" },
  { label: "uses your tools" },
  { label: "asks permission when it matters", tone: "text-warning" },
  { label: "executes", tone: "text-accent" },
  { label: "verifies", tone: "text-verify" },
  { label: "recovers", tone: "text-recover" },
  { label: "learns", tone: "text-success" },
];

const MODES = [
  {
    stage: "dormant",
    label: "Traditional software",
    icon: MousePointerClickIcon,
    title: "You click everything.",
    body: "Every step is yours: open the calendar, find a gap, create the event, write the e-mail, make sure it went out.",
    visual: <ClickTrail />,
  },
  {
    stage: "goal",
    label: "AI chatbot",
    icon: MessageSquareIcon,
    title: "You ask questions.",
    body: "It answers, drafts and suggests. It doesn't act on your systems — and nothing it says has been checked against them.",
    visual: <ChatSketch />,
  },
  {
    stage: "idle",
    label: "AgentOS",
    icon: SparklesIcon,
    title: "You give goals.",
    body: null,
    visual: (
      <div className="mt-5">
        <p className="flex max-w-full items-start gap-2 rounded-lg border border-accent/25 bg-accent/[0.06] px-3 py-2 font-mono text-xs leading-relaxed text-fg">
          <span className="text-accent" aria-hidden>
            ›
          </span>
          <span>Find a free 30-minute slot tomorrow, schedule a meeting, and send a confirmation.</span>
        </p>
        <VerbSequence
          verbs={VERBS}
          className="mt-6 text-[1.65rem] leading-[1.18] font-semibold tracking-[-0.03em] sm:text-[2rem]"
        />
      </div>
    ),
  },
] as const;

export function WhatIsSection() {
  return (
    <section id="system" aria-labelledby="system-title" className="relative scroll-mt-16 pt-24 pb-8 lg:pt-40">
      <Container>
        <div className={cn("max-w-xl", MOBILE_CARD)}>
          <Eyebrow index="01">What is an AI agent OS?</Eyebrow>
          <h2
            id="system-title"
            className="mt-5 text-[2.25rem] leading-[1.04] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-display-sm md:text-[3.25rem]"
          >
            From clicking everything to giving goals.
          </h2>
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-pretty text-fg-muted">
            An operating system for AI turns intent into verified outcomes: it owns the plan, the permissions, the
            tools, the checks and the memory — so the model never has the last word on what happened.
          </p>
        </div>
        <ol className="mt-4 flex max-w-xl flex-col">
          {MODES.map((m) => (
            <li
              key={m.label}
              data-stage={m.stage}
              className={cn(
                "flex min-h-[88svh] flex-col justify-end py-10 lg:min-h-[72vh] lg:justify-center",
                EMPHASIS,
              )}
            >
              <div className={MOBILE_CARD}>
                <p className="flex items-center gap-2 font-mono text-2xs tracking-[0.2em] text-fg-subtle uppercase">
                  <m.icon className="size-3.5" aria-hidden />
                  {m.label}
                </p>
                <h3 className="mt-3 text-[2rem] font-semibold tracking-[-0.035em] text-fg sm:text-[2.6rem]">
                  {m.title}
                </h3>
                {m.body && <p className="mt-3 max-w-lg leading-relaxed text-pretty text-fg-muted">{m.body}</p>}
                {m.visual}
              </div>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

/* ───────────────────────────── The execution loop ───────────────────────────── */

const CHAPTERS = [
  {
    stage: "goal",
    n: "01",
    name: "Goal",
    phases: ["GOAL"],
    title: "Say what you want done.",
    body: "A goal in plain language, with context. AgentOS records it durably before anything else happens — every task gets an ordered, gap-free event log from its first second.",
    evidence: { k: "TASK_CREATED", v: "seq 1 · actor user", tone: "text-accent" },
  },
  {
    stage: "plan",
    n: "02",
    name: "Plan & validate",
    phases: ["PLAN", "VALIDATE"],
    title: "The model proposes. Code decides.",
    body: "The planner drafts a dependency graph of steps using only registered tools. Deterministic validation checks the graph, every argument, every reference and your policy — invalid plans are repaired or rejected before a single tool runs.",
    evidence: { k: "PLAN_VALIDATED", v: "4 steps · approvals_expected 2", tone: "text-accent" },
  },
  {
    stage: "act",
    n: "03",
    name: "Approve & execute",
    phases: ["APPROVE", "EXECUTE"],
    title: "Permission first. Then action.",
    body: "Each step passes the policy engine: allow, require approval or deny. An approval is bound to the exact action and arguments, expires, and works once. Reads run in parallel; side effects run one at a time through an idempotency ledger.",
    evidence: { k: "APPROVAL_REQUIRED", v: "calendar.create_event · risk high", tone: "text-warning" },
  },
  {
    stage: "verify",
    n: "04",
    name: "Verify & recover",
    phases: ["VERIFY", "RECOVER", "COMPLETE"],
    title: "Nothing is done until it's verified.",
    body: "After every write, AgentOS reads the result back from the real system and compares it. An ambiguous outcome is reconciled with the provider instead of blindly retried — a timeout never turns into a second e-mail or a duplicate event.",
    evidence: { k: "VERIFICATION_PASSED", v: "method read_back", tone: "text-verify" },
  },
  {
    stage: "learn",
    n: "05",
    name: "Learn",
    phases: ["LEARN"],
    title: "Better with every verified run.",
    body: "Useful facts become memories with confidence and freshness. Recurring, verified failures become candidate strategies that must beat the baseline in controlled experiments before a person promotes them.",
    evidence: { k: "memory.extract", v: "confidence 0.92 · fresh", tone: "text-success" },
  },
] as const;

const PHASE_TONE: Record<string, string> = {
  APPROVE: "text-warning border-warning/30",
  VERIFY: "text-verify border-verify/30",
  RECOVER: "text-recover border-recover/30",
  COMPLETE: "text-success border-success/30",
};

export function LoopSection() {
  return (
    <section id="loop" aria-labelledby="loop-title" className="relative scroll-mt-16 pt-24 pb-24 lg:pt-40 lg:pb-40">
      <Container>
        <div className={cn("max-w-xl", MOBILE_CARD)}>
          <SectionHeader
            index="02"
            eyebrow="The execution loop"
            title={<span id="loop-title">One loop. Every task. No shortcuts.</span>}
            lede="LLM proposes. Backend decides. Tools execute. Verifier confirms. Every stage is enforced by deterministic code — the model can make a plan stricter, never looser."
          />
        </div>
        <div className="sticky top-20 z-20 mt-10 hidden w-fit lg:block">
          <LifecycleRail className="flex-nowrap rounded-full border border-line bg-bg/90 px-4 py-2.5 shadow-float backdrop-blur-md" />
        </div>
        <ol className="flex max-w-xl flex-col">
          {CHAPTERS.map((c) => (
            <li
              key={c.stage}
              data-stage={c.stage}
              className={cn(
                "flex min-h-[92svh] flex-col justify-end py-10 lg:min-h-[82vh] lg:justify-center",
                EMPHASIS,
              )}
            >
              <article className={MOBILE_CARD} aria-labelledby={`loop-${c.stage}`}>
                <p className="flex items-baseline gap-3 font-mono text-2xs tracking-[0.2em] text-fg-subtle uppercase">
                  <span className="text-accent">{c.n}</span>
                  {c.name}
                </p>
                <h3
                  id={`loop-${c.stage}`}
                  className="mt-3 text-[2rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-[2.6rem]"
                >
                  {c.title}
                </h3>
                <p className="mt-4 max-w-lg leading-relaxed text-pretty text-fg-muted">{c.body}</p>
                <div className="mt-6 flex flex-wrap items-center gap-2">
                  {c.phases.map((p) => (
                    <span
                      key={p}
                      className={cn(
                        "rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-[0.18em] uppercase",
                        PHASE_TONE[p] ?? "border-accent/30 text-accent",
                      )}
                    >
                      {p}
                    </span>
                  ))}
                  <span className="ml-1 font-mono text-2xs text-fg-subtle">
                    <span className={c.evidence.tone}>{c.evidence.k}</span> · {c.evidence.v}
                  </span>
                </div>
              </article>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
