import { CheckIcon, MinusIcon } from "lucide-react";
import type { Metadata } from "next";
import { marketingMetadata } from "@/components/marketing/metadata";
import { PageHero } from "@/components/marketing/page-hero";
import { featureLabel, PlanCard, PlansUnavailable, quotaLabel, quotaRows } from "@/components/marketing/plans";
import { Container, Section, SectionHeader } from "@/components/marketing/primitives";
import type { PlanOut } from "@/lib/api";
import { getPublicPlans } from "@/lib/api/public";

// Plans come from GET /billing/plans and are regenerated at most every 5 minutes.
export const revalidate = 300;

export const metadata: Metadata = marketingMetadata({
  title: "Pricing & plans",
  description:
    "Compare AgentOS plans: monthly task, model-call, tool-call, browser and search quotas, concurrency, automations, members and capabilities — loaded live from the AgentOS API.",
  path: "/pricing",
});

const nf = new Intl.NumberFormat("en-US");

function ComparisonTable({ plans }: { plans: PlanOut[] }) {
  const quotaKeys = [...new Set(plans.flatMap((p) => Object.keys(p.monthly_quotas)))];
  const features = [...new Set(plans.flatMap((p) => p.features))].sort((a, b) =>
    featureLabel(a).localeCompare(featureLabel(b)),
  );

  const rows: Array<{ label: string; values: string[] | boolean[]; group?: string }> = [
    { group: "Limits", label: "Concurrent tasks", values: plans.map((p) => nf.format(p.max_concurrent_tasks)) },
    { label: "Automations", values: plans.map((p) => nf.format(p.max_automations)) },
    { label: "Members", values: plans.map((p) => nf.format(p.max_members)) },
    ...quotaKeys.map((key, i) => ({
      group: i === 0 ? "Monthly quotas" : undefined,
      label: `${quotaLabel(key)} / month`,
      values: plans.map((p) => quotaRows(p).find((q) => q.key === key)?.value ?? "Custom"),
    })),
    ...features.map((f, i) => ({
      group: i === 0 ? "Capabilities" : undefined,
      label: featureLabel(f),
      values: plans.map((p) => p.features.includes(f)),
    })),
  ];

  return (
    <div className="overflow-x-auto rounded-2xl border border-line">
      <table className="w-full min-w-[640px] text-left text-sm">
        <caption className="sr-only">Plan comparison</caption>
        <thead className="bg-surface-2">
          <tr>
            <th
              scope="col"
              className="px-5 py-4 font-mono text-[10.5px] font-normal tracking-[0.16em] text-fg-subtle uppercase"
            >
              Plan
            </th>
            {plans.map((p) => (
              <th key={p.name} scope="col" className="px-5 py-4 text-[15px] font-semibold text-fg">
                {p.display_name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-surface-1">
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-line">
              <th scope="row" className="px-5 py-3 font-normal text-fg-muted">
                {r.group && (
                  <span className="mb-1 block font-mono text-[10px] tracking-[0.18em] text-accent uppercase">
                    {r.group}
                  </span>
                )}
                {r.label}
              </th>
              {r.values.map((v, i) => (
                <td key={i} className="px-5 py-3 font-mono text-xs text-fg">
                  {typeof v === "boolean" ? (
                    v ? (
                      <CheckIcon className="size-4 text-accent" aria-label="Included" />
                    ) : (
                      <MinusIcon className="size-4 text-fg-subtle" aria-label="Not included" />
                    )
                  ) : (
                    v
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const FAQ = [
  {
    q: "What counts as a task?",
    a: "Every goal you hand AgentOS becomes one task. Model calls, tool calls, browser time, searches and automation runs are metered against their own monthly quotas.",
  },
  {
    q: "Are approvals, verification and the audit trail on every plan?",
    a: "Yes. Policy, approvals, read-back verification, recovery and the audit log are part of the pipeline itself. Plans differ in capacity and in optional capabilities such as automations, the isolated browser and MCP servers.",
  },
  {
    q: "What happens when I reach a limit?",
    a: "New work over a quota or over your concurrent-task limit is refused with a clear error (quota_exceeded or too_many_active_tasks) instead of being silently queued. Usage is visible in your workspace at any time.",
  },
  {
    q: "Can I change plans later?",
    a: "Plans apply per organization, so a team can grow from one plan to the next without changing how its agents, approvals or automations work.",
  },
];

export default async function PricingPage() {
  const result = await getPublicPlans();
  const plans = result.ok ? result.data : [];

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title={
          <>
            One verified pipeline.
            <span className="block text-fg-muted">Plans that scale it.</span>
          </>
        }
        lede="Every plan runs the same lifecycle — policy, approvals, verification, recovery and audit. The limits below are loaded live from the AgentOS API: the same plan definitions the platform enforces."
      />

      <Section aria-label="Plans" className="py-16 md:py-24">
        {plans.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => (
              <li key={p.name}>
                <PlanCard plan={p} />
              </li>
            ))}
          </ul>
        ) : (
          <PlansUnavailable />
        )}
      </Section>

      {plans.length > 0 && (
        <Section id="compare" aria-labelledby="compare-title" className="border-t border-line py-16 md:py-24">
          <SectionHeader eyebrow="Compare" title={<span id="compare-title">Every limit, side by side.</span>} />
          <div className="mt-10">
            <ComparisonTable plans={plans} />
          </div>
        </Section>
      )}

      <Section id="faq" aria-labelledby="faq-title" className="border-t border-line py-16 md:py-24">
        <SectionHeader eyebrow="Questions" title={<span id="faq-title">Good to know.</span>} />
        <Container className="mt-10 px-0 sm:px-0">
          <dl className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line md:grid-cols-2">
            {FAQ.map((f) => (
              <div key={f.q} className="bg-surface-1 p-6">
                <dt className="text-[15px] font-semibold tracking-tight text-fg">{f.q}</dt>
                <dd className="mt-2 text-sm leading-relaxed text-fg-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </Container>
      </Section>
    </>
  );
}
