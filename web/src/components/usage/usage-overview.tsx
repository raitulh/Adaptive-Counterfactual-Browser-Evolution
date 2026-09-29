"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangleIcon,
  BarChart3Icon,
  CircleDollarSignIcon,
  GaugeIcon,
  InfinityIcon,
  OctagonAlertIcon,
  Table2Icon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { MetricCard } from "@/components/ui/data-display";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usageApi, type UsageSummary } from "@/lib/api";
import { useOrganization, usePermissions } from "@/lib/auth/hooks";
import { dateOnly, humanize, usd } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useNow } from "@/components/settings/use-now";
import { DailyChart } from "./daily-chart";
import { buildMeters, dailyKinds, dailySeries, formatMetric, metricMeta, otherTotals, type Meter } from "./usage-math";

const monthFmt = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

export function UsageOverview() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = usePermissions();
  const { organization } = useOrganization();
  // The backend widens to the organization only for callers with audit:read (owners/admins).
  const canOrgWide = can("audit:read");
  const orgWide = canOrgWide && params.get("scope") === "organization";
  const usage = useQuery({
    queryKey: qk.usage(orgWide),
    queryFn: ({ signal }) => usageApi.summary({ org_wide: orgWide }, { signal }),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const setScope = (scope: string) => {
    const next = new URLSearchParams(params.toString());
    if (scope === "organization") next.set("scope", "organization");
    else next.delete("scope");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const data = usage.data;
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Metering"
        title="Usage"
        description={
          data ? (
            <>
              {monthFmt.format(new Date(`${data.period_start}T00:00:00Z`))} so far (since{" "}
              {dateOnly(`${data.period_start}T00:00:00Z`)}, UTC), measured against the{" "}
              <span className="font-medium text-fg">{humanize(data.plan)}</span> plan&apos;s monthly quotas. Quotas
              reset on the 1st of each month.
            </>
          ) : (
            "Metered consumption this month against your plan's quotas."
          )
        }
        actions={
          canOrgWide ? (
            <Tabs value={orgWide ? "organization" : "me"} onValueChange={setScope}>
              <TabsList aria-label="Usage scope">
                <TabsTrigger value="me">Just me</TabsTrigger>
                <TabsTrigger value="organization">Whole organization</TabsTrigger>
              </TabsList>
            </Tabs>
          ) : undefined
        }
      />
      {usage.error && !data ? (
        <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />
      ) : !data ? (
        <UsageSkeleton />
      ) : (
        <UsageBody data={data} orgName={organization?.name} refreshing={usage.isFetching && usage.isPlaceholderData} />
      )}
    </PageContainer>
  );
}

function UsageSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function UsageBody({ data, orgName, refreshing }: { data: UsageSummary; orgName?: string; refreshing: boolean }) {
  const meters = buildMeters(data.totals, data.quotas);
  const others = otherTotals(
    data.totals,
    meters.map((m) => m.key),
  );
  const attention = meters.filter((m) => m.state === "near" || m.state === "at_limit" || m.state === "over");
  const scopeOrg = data.scope === "organization";
  const empty = Object.keys(data.totals).length === 0;

  return (
    <div className={cn("flex flex-col gap-6 transition-opacity", refreshing && "opacity-60")}>
      <p className="-mt-2 text-[13px] text-fg-muted">
        {scopeOrg ? (
          <>
            Showing usage by <span className="font-medium text-fg">everyone in {orgName ?? "this organization"}</span>.
          </>
        ) : (
          <>
            Showing <span className="font-medium text-fg">your own usage</span>. Quotas are shared by everyone in{" "}
            {orgName ?? "the organization"}, so the organization can reach a limit before you do.
          </>
        )}
      </p>

      {attention.length > 0 && (
        <div
          role="alert"
          className={cn(
            "flex items-start gap-3 rounded-xl border px-4 py-3 text-[13px]",
            attention.some((m) => m.state !== "near")
              ? "border-danger/30 bg-danger/8 text-danger"
              : "border-warning/30 bg-warning/8 text-warning",
          )}
        >
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div>
            {attention.map((m) => metricMeta(m.key).label).join(", ")} {attention.length === 1 ? "is" : "are"}{" "}
            {attention.some((m) => m.state !== "near") ? "at or over the monthly quota" : "close to the monthly quota"}.
            When a quota is reached, new work of that kind is refused until next month.{" "}
            <Link href="/app/billing" className="underline underline-offset-2">
              Compare plans
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Model & tool cost"
          value={usd(data.cost_usd)}
          icon={<CircleDollarSignIcon />}
          hint="Metered provider cost this month"
        />
        {["task_created", "model_call", "tool_call"].map((k) => (
          <MetricCard
            key={k}
            label={metricMeta(k).label}
            value={formatMetric(k, data.totals[k] ?? 0, { compact: true })}
            hint={
              data.quotas[k] !== undefined
                ? `of ${formatMetric(k, data.quotas[k], { compact: true })} included`
                : "No monthly cap"
            }
          />
        ))}
      </div>

      <section aria-labelledby="quota-title" className="flex flex-col gap-3">
        <div>
          <h2 id="quota-title" className="text-sm font-semibold tracking-tight text-fg">
            Monthly quotas
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Included in the {humanize(data.plan)} plan. Usage counts toward the organization&apos;s quota.
          </p>
        </div>
        {meters.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<InfinityIcon />}
            title="No monthly quotas"
            description="Your plan doesn't cap usage. Everything is still metered below."
            className="rounded-xl border border-line bg-surface-1"
          />
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {meters.map((m) => (
              <QuotaMeter key={m.key} meter={m} scopeOrg={scopeOrg} />
            ))}
          </ul>
        )}
      </section>

      <DailySection data={data} />

      {others.length > 0 && (
        <section aria-labelledby="other-title" className="flex flex-col gap-3">
          <div>
            <h2 id="other-title" className="text-sm font-semibold tracking-tight text-fg">
              Other metered usage
            </h2>
            <p className="mt-0.5 text-[13px] text-fg-muted">Tracked for transparency; not capped by your plan.</p>
          </div>
          <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Other metered usage</caption>
              <tbody>
                {others.map(([k, v]) => (
                  <tr key={k} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2.5 font-normal">
                      <div className="text-fg">{metricMeta(k).label}</div>
                      <div className="text-xs text-fg-subtle">{metricMeta(k).description}</div>
                    </th>
                    <td className="px-4 py-2.5 text-right font-medium text-fg tabular-nums">{formatMetric(k, v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {empty && (
        <EmptyState
          size="sm"
          icon={<GaugeIcon />}
          title="Nothing used yet this month"
          description="Usage appears as soon as tasks run — every task, model call, tool call and search is metered."
          action={
            <Button asChild variant="secondary" size="sm">
              <Link href="/app">Start a task</Link>
            </Button>
          }
        />
      )}
    </div>
  );
}

function QuotaMeter({ meter, scopeOrg }: { meter: Meter; scopeOrg: boolean }) {
  const meta = metricMeta(meter.key);
  const t = toneClasses[meter.tone];
  const stateLabel =
    meter.state === "over"
      ? "Over quota"
      : meter.state === "at_limit"
        ? "Limit reached"
        : meter.state === "near"
          ? "Near limit"
          : null;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-fg">{meta.label}</h3>
          <p className="truncate text-xs text-fg-subtle">{meta.description}</p>
        </div>
        {stateLabel && (
          <Badge tone={meter.tone}>
            {meter.state === "near" ? (
              <AlertTriangleIcon className="size-3" aria-hidden />
            ) : (
              <OctagonAlertIcon className="size-3" aria-hidden />
            )}
            {stateLabel}
          </Badge>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tracking-tight text-fg tabular-nums">
          {formatMetric(meter.key, meter.used)}
        </span>
        <span className="text-[13px] text-fg-subtle">
          {meter.limit !== null ? `of ${formatMetric(meter.key, meter.limit)}` : "· no cap"}
        </span>
      </div>
      {meter.percent !== null ? (
        <div
          role="meter"
          aria-label={`${meta.label} used`}
          aria-valuemin={0}
          aria-valuemax={meter.limit ?? undefined}
          aria-valuenow={Math.min(meter.used, meter.limit ?? meter.used)}
          aria-valuetext={`${formatMetric(meter.key, meter.used)} of ${formatMetric(meter.key, meter.limit)}`}
          className={cn("h-2 w-full overflow-hidden rounded-full", t.soft)}
        >
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", t.bg)}
            style={{ width: `${Math.max(meter.used > 0 ? 1.5 : 0, meter.percent)}%` }}
          />
        </div>
      ) : (
        <div className="h-2 w-full rounded-full bg-white/[0.04]" aria-hidden />
      )}
      <p className="text-xs text-fg-subtle">
        {meter.limit === null
          ? "Unlimited on this plan"
          : meter.state === "over" || meter.state === "at_limit"
            ? scopeOrg
              ? "New work of this kind is refused until the quota resets."
              : "Your usage alone has reached the organization's quota."
            : `${Math.round((meter.ratio ?? 0) * 100)}% used · ${formatMetric(meter.key, meter.remaining)} left${scopeOrg ? "" : " (based on your usage only)"}`}
      </p>
    </li>
  );
}

function DailySection({ data }: { data: UsageSummary }) {
  const now = useNow(60_000);
  const kinds = dailyKinds(data.by_day);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [table, setTable] = React.useState(false);
  const kind =
    picked && kinds.includes(picked) ? picked : (kinds.find((k) => k === "task_created") ?? kinds[0] ?? null);
  const points = kind ? dailySeries(data.by_day, kind, data.period_start, new Date(now)) : [];
  const hasTotals = Object.keys(data.totals).length > 0;

  return (
    <section aria-labelledby="daily-title" className="rounded-xl border border-line bg-surface-1 p-5">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="daily-title" className="text-sm font-semibold tracking-tight text-fg">
            Daily {kind ? metricMeta(kind).label.toLowerCase() : "usage"}
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-muted">
            Per UTC day. Compiled from metering events every few minutes, so the latest activity can lag slightly.
          </p>
        </div>
        {kinds.length > 0 && (
          <div className="flex items-center gap-2">
            <Select value={kind ?? undefined} onValueChange={setPicked}>
              <SelectTrigger className="h-8 w-44" aria-label="Metric">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k} value={k}>
                    {metricMeta(k).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" onClick={() => setTable((v) => !v)} aria-pressed={table}>
              {table ? <BarChart3Icon /> : <Table2Icon />}
              {table ? "Chart" : "Table"}
            </Button>
          </div>
        )}
      </div>
      {kind && points.length > 0 ? (
        <DailyChart kind={kind} points={points} showTable={table} />
      ) : (
        <EmptyState
          size="sm"
          icon={<BarChart3Icon />}
          title={hasTotals ? "Daily breakdown not compiled yet" : "No daily activity yet"}
          description={
            hasTotals
              ? "This month's totals above are live; the per-day roll-up is produced periodically by the background scheduler and will appear here."
              : "Once work runs this month, you'll see how it's spread across days."
          }
        />
      )}
    </section>
  );
}
