import {
  AppWindowIcon,
  ArrowRightIcon,
  DatabaseIcon,
  FingerprintIcon,
  KeyRoundIcon,
  NetworkIcon,
  ScrollTextIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { AgentCoreFallback } from "@/components/three/AgentCoreFallback";
import { Button } from "@/components/ui/button";
import { getPublicPlans } from "@/lib/api/public";
import { LiveDemo } from "../demo/live-demo";
import { monthlyTasks, PlansUnavailable } from "../plans";
import { Container, Section, SectionHeader } from "../primitives";

/* ────────────────────────────── Live demo ────────────────────────────── */

export function DemoSection() {
  return (
    <Section id="demo" aria-labelledby="demo-title" className="border-t border-line">
      <div className="grid items-end gap-6 lg:grid-cols-[1.1fr_1fr]">
        <SectionHeader
          index="04"
          eyebrow="See it run"
          title={<span id="demo-title">Watch one goal become verified work.</span>}
        />
        <p className="max-w-lg text-[17px] leading-relaxed text-pretty text-fg-muted lg:pb-2">
          A simulated run of a real AgentOS workflow — the same plan shape, events, approval gates and read-backs the
          product records. The approvals are yours to decide.
        </p>
      </div>
      <div className="relative mt-12">
        <div
          className="pointer-events-none absolute -inset-x-24 -top-24 bottom-0 bg-[radial-gradient(50%_40%_at_50%_0%,rgb(92_225_230/0.09),transparent_70%)]"
          aria-hidden
        />
        <LiveDemo className="relative" />
      </div>
    </Section>
  );
}

/* ────────────────────────────── Security ────────────────────────────── */

const SECURITY: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: DatabaseIcon,
    title: "Tenant isolation in the data layer",
    body: "The tenant comes from the verified session, never the request. Every query is scoped automatically; an unscoped query fails instead of leaking.",
  },
  {
    icon: KeyRoundIcon,
    title: "Encrypted credentials",
    body: "OAuth tokens and secrets are encrypted at rest with rotatable keys, decrypted only by the credential vault, and never returned by the API.",
  },
  {
    icon: FingerprintIcon,
    title: "Sessions built to be stolen from",
    body: "HttpOnly refresh cookies rotated on every use with reuse detection, double-submit CSRF, TOTP MFA and immediate revocation.",
  },
  {
    icon: ScrollTextIcon,
    title: "Append-only audit",
    body: "Audit rows commit with the change they record; the database rejects updates and deletes.",
  },
  {
    icon: NetworkIcon,
    title: "SSRF-safe egress",
    body: "Every model-, user- or page-chosen URL is resolved and vetted; private and metadata ranges are blocked on every redirect hop.",
  },
  {
    icon: AppWindowIcon,
    title: "Isolated browser",
    body: "Browser automation runs in its own worker, forced through a per-task egress proxy, with network policy as a second wall.",
  },
];

export function SecuritySection() {
  return (
    <Section id="security" aria-labelledby="security-title" className="border-t border-line">
      <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <SectionHeader
          index="10"
          eyebrow="Security architecture"
          title={<span id="security-title">Security is the architecture, not a feature.</span>}
          lede="Designed for an agent that acts with real accounts: untrusted inputs, least privilege, and no single process trusted with everything."
        />
        <Button asChild variant="outline" className="w-fit shrink-0">
          <Link href="/security">
            Read the security architecture <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </div>
      <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {SECURITY.map((s) => (
          <li key={s.title} className="flex flex-col gap-3 bg-surface-1 p-6">
            <s.icon className="size-5 text-fg-muted" aria-hidden />
            <h3 className="text-[15px] font-semibold tracking-tight text-fg">{s.title}</h3>
            <p className="text-sm leading-relaxed text-fg-muted">{s.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/* ────────────────────────────── Pricing teaser ────────────────────────────── */

export async function PricingTeaser() {
  const plans = await getPublicPlans();
  return (
    <Section id="pricing" aria-labelledby="pricing-title" className="border-t border-line">
      <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
        <SectionHeader
          index="11"
          eyebrow="Plans"
          title={<span id="pricing-title">Start free. Scale when it works.</span>}
          lede="Every plan runs the same verified pipeline. Plans differ in capacity and in the capabilities your organization can turn on."
        />
        <Button asChild variant="outline" className="w-fit shrink-0">
          <Link href="/pricing">
            Compare plans <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </div>
      {plans.ok && plans.data.length > 0 ? (
        <ul className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {plans.data.map((p) => (
            <li key={p.name} className="flex flex-col gap-4 bg-surface-1 p-6">
              <h3 className="text-[15px] font-semibold text-fg">{p.display_name}</h3>
              <p className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-[-0.03em] text-fg">{monthlyTasks(p)}</span>
                <span className="text-sm text-fg-muted">
                  {p.monthly_quotas.task_created !== undefined ? "tasks / month" : "quotas"}
                </span>
              </p>
              <p className="font-mono text-[11px] leading-relaxed text-fg-subtle">
                {p.max_concurrent_tasks} concurrent · {p.max_automations.toLocaleString("en-US")} automations ·{" "}
                {p.max_members.toLocaleString("en-US")} member{p.max_members === 1 ? "" : "s"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <PlansUnavailable className="mt-14" />
      )}
    </Section>
  );
}

/* ────────────────────────────── Final CTA ────────────────────────────── */

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className="relative overflow-hidden border-t border-line">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(50%_60%_at_50%_100%,rgb(92_225_230/0.10),transparent_70%)]" />
        <AgentCoreFallback
          id="cta-core"
          stage="learn"
          animate={false}
          labels={false}
          className="absolute top-full left-1/2 w-[1100px] max-w-none -translate-x-1/2 -translate-y-[38%] opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-bg via-bg/60 to-transparent" />
      </div>
      <Container className="relative flex flex-col items-center py-32 text-center md:py-44">
        <h2
          id="cta-title"
          className="text-[clamp(2.5rem,6vw,4.75rem)] leading-[0.98] font-semibold tracking-[-0.045em] text-balance text-fg"
        >
          Give AI a goal.
          <span className="block text-fg-muted">AgentOS gets the work done.</span>
        </h2>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-pretty text-fg-muted">
          Connect your Google Workspace, set your policy, and hand over the first goal. You stay in control of every
          action that matters.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <Button asChild variant="primary" size="lg" className="h-12 px-6 text-[15px]">
            <Link href="/signup">
              Start building <ArrowRightIcon aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg" className="h-12 bg-bg/40 px-6 text-[15px]">
            <Link href="/docs">Read the docs</Link>
          </Button>
        </div>
      </Container>
    </section>
  );
}
