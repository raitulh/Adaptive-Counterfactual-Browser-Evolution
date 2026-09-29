"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, CheckIcon, InfoIcon, MinusIcon, ShieldAlertIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { ErrorState } from "@/components/ui/states";
import { billingApi, type EntitlementsOut, type PlanOut } from "@/lib/api";
import { useOrganization, usePermissions } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { formatMetric, metricMeta, QUOTA_ORDER } from "@/components/usage/usage-math";

const FEATURE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  drive: "Google Drive",
  memory: "Memory",
  search: "Web search",
  browser: "Browser agent",
  mcp: "MCP servers",
  automations: "Automations",
  rbac: "Roles & permissions",
  audit_export: "Audit export",
  sso: "Single sign-on",
  data_residency: "Data residency",
};

export function featureLabel(key: string): string {
  return FEATURE_LABEL[key] ?? humanize(key);
}

function limit(n: number): string {
  return n.toLocaleString("en-US");
}

/** Union of quota keys across plans, in the canonical order. */
function quotaKeys(plans: PlanOut[]): string[] {
  const all = new Set(plans.flatMap((p) => Object.keys(p.monthly_quotas)));
  return [...QUOTA_ORDER.filter((k) => all.has(k)), ...[...all].filter((k) => !QUOTA_ORDER.includes(k))];
}

function featureKeys(plans: PlanOut[]): string[] {
  const seen: string[] = [];
  for (const p of plans) for (const f of p.features) if (!seen.includes(f)) seen.push(f);
  return seen;
}

export function BillingOverview() {
  const plans = useQuery({
    queryKey: qk.billing.plans,
    queryFn: ({ signal }) => billingApi.plans({ signal }),
    staleTime: 10 * 60_000,
  });
  const entitlements = useQuery({
    queryKey: qk.billing.entitlements,
    queryFn: ({ signal }) => billingApi.entitlements({ signal }),
    staleTime: 60_000,
  });
  const error = plans.error ?? entitlements.error;

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Plan & entitlements"
        title="Billing"
        description="Your organization's plan, what it includes, and how it compares with the other plans."
      />
      {error ? (
        <ErrorState error={error} onRetry={() => void Promise.all([plans.refetch(), entitlements.refetch()])} />
      ) : !plans.data || !entitlements.data ? (
        <div className="flex flex-col gap-6" aria-busy>
          <Skeleton className="h-40 rounded-xl" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-96 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <BillingBody plans={plans.data} entitlements={entitlements.data} />
      )}
    </PageContainer>
  );
}

function BillingBody({ plans, entitlements }: { plans: PlanOut[]; entitlements: EntitlementsOut }) {
  const current = entitlements.plan;
  const { organization } = useOrganization();
  const quotas = quotaKeys(plans);
  const features = featureKeys(plans);

  return (
    <div className="flex flex-col gap-8">
      <CurrentPlan plan={current} provider={entitlements.billing_provider} orgName={organization?.name} />

      <section aria-labelledby="plans-title" className="flex flex-col gap-4">
        <h2 id="plans-title" className="text-sm font-semibold tracking-tight text-fg">
          Plans
        </h2>
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((p) => (
            <PlanCard key={p.name} plan={p} current={p.name === current.name} quotas={quotas} />
          ))}
        </ul>
      </section>

      <section aria-labelledby="compare-title" className="flex flex-col gap-3">
        <h2 id="compare-title" className="text-sm font-semibold tracking-tight text-fg">
          Compare plans
        </h2>
        <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-1">
          <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
            <caption className="sr-only">Plan comparison</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="w-56 px-4 py-3 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                  Included
                </th>
                {plans.map((p) => (
                  <th
                    key={p.name}
                    scope="col"
                    className={cn(
                      "px-4 py-3 text-sm font-semibold text-fg",
                      p.name === current.name && "bg-accent/[0.06]",
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {p.display_name}
                      {p.name === current.name && <Badge tone="accent">Current</Badge>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <GroupRow label="Monthly quotas" span={plans.length + 1} />
              {quotas.map((k) => (
                <tr key={k} className="border-b border-line">
                  <th scope="row" className="px-4 py-2.5 font-normal text-fg-muted">
                    {metricMeta(k).label}
                  </th>
                  {plans.map((p) => (
                    <td
                      key={p.name}
                      className={cn("px-4 py-2.5 text-fg tabular-nums", p.name === current.name && "bg-accent/[0.06]")}
                    >
                      {p.monthly_quotas[k] !== undefined ? (
                        formatMetric(k, p.monthly_quotas[k])
                      ) : (
                        <span className="text-success">Unlimited</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              <GroupRow label="Limits" span={plans.length + 1} />
              {(
                [
                  ["Concurrent tasks per person", "max_concurrent_tasks"],
                  ["Automations", "max_automations"],
                  ["Members", "max_members"],
                ] as const
              ).map(([label, key]) => (
                <tr key={key} className="border-b border-line">
                  <th scope="row" className="px-4 py-2.5 font-normal text-fg-muted">
                    {label}
                  </th>
                  {plans.map((p) => (
                    <td
                      key={p.name}
                      className={cn("px-4 py-2.5 text-fg tabular-nums", p.name === current.name && "bg-accent/[0.06]")}
                    >
                      {limit(p[key])}
                    </td>
                  ))}
                </tr>
              ))}
              <GroupRow label="Features" span={plans.length + 1} />
              {features.map((f) => (
                <tr key={f} className="border-b border-line last:border-0">
                  <th scope="row" className="px-4 py-2.5 font-normal text-fg-muted">
                    {featureLabel(f)}
                  </th>
                  {plans.map((p) => {
                    const has = p.features.includes(f);
                    return (
                      <td key={p.name} className={cn("px-4 py-2.5", p.name === current.name && "bg-accent/[0.06]")}>
                        {has ? (
                          <CheckIcon className="size-4 text-success" aria-label="Included" />
                        ) : (
                          <MinusIcon className="size-4 text-fg-subtle" aria-label="Not included" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function GroupRow({ label, span }: { label: string; span: number }) {
  return (
    <tr className="border-b border-line bg-surface-2/60">
      <th
        colSpan={span}
        scope="colgroup"
        className="px-4 py-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase"
      >
        {label}
      </th>
    </tr>
  );
}

function CurrentPlan({ plan, provider, orgName }: { plan: PlanOut; provider: string; orgName?: string }) {
  const { isPlatformAdmin, can } = usePermissions();
  const noProvider = provider === "none";
  return (
    <section
      aria-labelledby="current-plan"
      className="grid gap-5 rounded-xl border border-accent/25 bg-gradient-to-br from-accent/[0.07] via-surface-1 to-surface-1 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]"
    >
      <div className="flex flex-col gap-3">
        <div className="text-2xs font-medium tracking-[0.14em] text-accent uppercase">
          Current plan{orgName ? ` · ${orgName}` : ""}
        </div>
        <h2 id="current-plan" className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-fg">
          <SparklesIcon className="size-5 text-accent" aria-hidden /> {plan.display_name}
        </h2>
        <p className="text-[13px] text-fg-muted">
          {plan.max_members.toLocaleString("en-US")} {plan.max_members === 1 ? "member" : "members"} ·{" "}
          {plan.max_concurrent_tasks} concurrent tasks per person · {limit(plan.max_automations)} automations
        </p>
        <div className="flex flex-wrap gap-1.5">
          {plan.features.map((f) => (
            <Badge key={f} tone="neutral" variant="outline">
              {featureLabel(f)}
            </Badge>
          ))}
        </div>
        <div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/app/usage">
              See this month&apos;s usage <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1/80 p-4">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-fg">
          <InfoIcon className="size-4 text-info" aria-hidden /> How plan changes work
        </h3>
        {noProvider ? (
          <p className="text-[13px] leading-relaxed text-fg-muted">
            This AgentOS deployment has no payment processor connected, so there is no online checkout and nothing is
            charged here. Plans are assigned by the platform administrators who run AgentOS. Usage is still metered
            against your plan&apos;s quotas.
          </p>
        ) : (
          <p className="text-[13px] leading-relaxed text-fg-muted">
            Billing for this deployment is handled by <span className="font-mono text-fg">{provider}</span>. Plan
            changes aren&apos;t available from the app — they are applied by the platform administrators who run
            AgentOS.
          </p>
        )}
        <p className="text-[13px] leading-relaxed text-fg-muted">
          {isPlatformAdmin ? (
            <>You are a platform administrator and can change any organization&apos;s plan from the admin console.</>
          ) : can("billing:manage") ? (
            <>
              As the organization owner, ask your AgentOS administrator to move {orgName ?? "this organization"} to a
              different plan.
            </>
          ) : (
            <>
              Ask an owner of {orgName ?? "this organization"} to request a plan change from your AgentOS administrator.
            </>
          )}
        </p>
        {isPlatformAdmin && (
          <div>
            <Button asChild variant="outline" size="sm">
              <Link href="/app/admin/organizations">
                <ShieldAlertIcon /> Change plans in Admin
              </Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

function PlanCard({ plan, current, quotas }: { plan: PlanOut; current: boolean; quotas: string[] }) {
  const unlimited = Object.keys(plan.monthly_quotas).length === 0;
  return (
    <li
      className={cn(
        "relative flex flex-col gap-4 rounded-xl border p-5",
        current ? "border-accent/40 bg-surface-2 shadow-[0_0_0_1px_rgb(92_225_230/0.15)]" : "border-line bg-surface-1",
      )}
      aria-current={current ? "true" : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight text-fg">{plan.display_name}</h3>
        {current ? <Badge tone="accent">Current plan</Badge> : null}
      </div>
      <dl className="grid gap-1.5 text-[13px]">
        {unlimited ? (
          <div className="flex items-center gap-2 text-success">
            <CheckIcon className="size-4" aria-hidden /> No monthly usage caps
          </div>
        ) : (
          quotas.map((k) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="text-fg-muted">{metricMeta(k).label}</dt>
              <dd className="text-fg tabular-nums">
                {plan.monthly_quotas[k] !== undefined
                  ? formatMetric(k, plan.monthly_quotas[k], { compact: true })
                  : "Unlimited"}
              </dd>
            </div>
          ))
        )}
      </dl>
      <dl className="grid gap-1.5 border-t border-line pt-3 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Members</dt>
          <dd className="text-fg tabular-nums">{limit(plan.max_members)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Concurrent tasks</dt>
          <dd className="text-fg tabular-nums">{plan.max_concurrent_tasks.toLocaleString("en-US")}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-fg-muted">Automations</dt>
          <dd className="text-fg tabular-nums">{limit(plan.max_automations)}</dd>
        </div>
      </dl>
      <ul className="grid gap-1.5 border-t border-line pt-3 text-[13px]" aria-label={`${plan.display_name} features`}>
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2 text-fg-muted">
            <CheckIcon className="size-3.5 shrink-0 text-success" aria-hidden /> {featureLabel(f)}
          </li>
        ))}
      </ul>
      <p className="mt-auto pt-2 text-xs text-fg-subtle">
        {current ? "Your organization is on this plan." : "Assigned by a platform administrator."}
      </p>
    </li>
  );
}
