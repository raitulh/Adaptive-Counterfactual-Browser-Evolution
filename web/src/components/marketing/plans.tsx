/**
 * Plan presentation for /pricing and the landing teaser. Plans, quotas and features are always the
 * live definitions from `GET /billing/plans` — nothing here is hard-coded except labels.
 */
import { ArrowRightIcon, CheckIcon, RefreshCwIcon } from "lucide-react";
import Link from "next/link";
import type { PlanOut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Panel } from "./primitives";

const QUOTA_LABELS: Record<string, { label: string; unit?: "minutes" }> = {
  task_created: { label: "tasks" },
  model_call: { label: "model calls" },
  tool_call: { label: "tool calls" },
  browser_seconds: { label: "browser minutes", unit: "minutes" },
  search_query: { label: "searches" },
  automation_run: { label: "automation runs" },
};

const FEATURE_LABELS: Record<string, string> = {
  gmail: "Gmail",
  calendar: "Google Calendar",
  drive: "Google Drive",
  memory: "Memory",
  search: "Web & document search",
  automations: "Scheduled automations",
  browser: "Isolated browser",
  mcp: "MCP servers",
  rbac: "Roles & permissions",
  audit_export: "Audit export",
  sso: "Single sign-on",
  data_residency: "Data residency",
};

const nf = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export function featureLabel(key: string): string {
  return FEATURE_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function quotaLabel(key: string): string {
  return (QUOTA_LABELS[key] ?? { label: key.replace(/_/g, " ") }).label;
}

export function quotaRows(plan: PlanOut): Array<{ key: string; label: string; value: string }> {
  return Object.entries(plan.monthly_quotas).map(([key, raw]) => {
    const meta = QUOTA_LABELS[key] ?? { label: key.replace(/_/g, " ") };
    const value = meta.unit === "minutes" ? Math.round(raw / 60) : raw;
    return { key, label: meta.label, value: value >= 100_000 ? compact.format(value) : nf.format(value) };
  });
}

export function monthlyTasks(plan: PlanOut): string {
  const v = plan.monthly_quotas.task_created;
  return typeof v === "number" ? (v >= 100_000 ? compact.format(v) : nf.format(v)) : "Custom";
}

function limit(n: number): string {
  return n >= 100_000 ? compact.format(n) : nf.format(n);
}

export function PlanCard({ plan, className }: { plan: PlanOut; className?: string }) {
  const quotas = quotaRows(plan);
  return (
    <Panel className={cn("flex h-full flex-col p-6", className)}>
      <h3 className="text-lg font-semibold tracking-tight text-fg">{plan.display_name}</h3>
      <p className="mt-1 font-mono text-[11px] text-fg-subtle">plan: {plan.name}</p>
      <p className="mt-6 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-[-0.03em] text-fg">{monthlyTasks(plan)}</span>
        <span className="text-sm whitespace-nowrap text-fg-muted">{quotas.length ? "tasks / month" : "quotas"}</span>
      </p>
      <dl className="mt-6 grid grid-cols-3 gap-2 border-y border-line py-4 text-center">
        {[
          ["Concurrent tasks", limit(plan.max_concurrent_tasks)],
          ["Automations", limit(plan.max_automations)],
          ["Members", limit(plan.max_members)],
        ].map(([k, v]) => (
          <div key={k}>
            <dd className="text-[15px] font-semibold text-fg">{v}</dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-fg-subtle">{k}</dt>
          </div>
        ))}
      </dl>
      <ul className="mt-5 flex flex-col gap-2 text-sm text-fg-muted" aria-label={`${plan.display_name} features`}>
        {plan.features.map((f) => (
          <li key={f} className="flex items-center gap-2">
            <CheckIcon className="size-3.5 shrink-0 text-accent" aria-hidden />
            {featureLabel(f)}
          </li>
        ))}
      </ul>
      {quotas.length > 1 && (
        <details className="group mt-5 text-sm">
          <summary className="cursor-pointer list-none font-mono text-[11px] text-fg-subtle transition-colors hover:text-fg-muted">
            <span className="group-open:hidden">+ All monthly quotas</span>
            <span className="hidden group-open:inline">− All monthly quotas</span>
          </summary>
          <dl className="mt-3 flex flex-col gap-1.5">
            {quotas.map((q) => (
              <div key={q.key} className="flex justify-between gap-3">
                <dt className="text-fg-subtle">{q.label}</dt>
                <dd className="font-mono text-xs text-fg-muted">{q.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      <div className="mt-auto pt-6">
        <Button asChild variant="outline" className="w-full">
          <Link href="/signup">
            Start building <ArrowRightIcon aria-hidden />
          </Link>
        </Button>
      </div>
    </Panel>
  );
}

export function PlansUnavailable({ className }: { className?: string }) {
  return (
    <Panel className={cn("flex flex-col items-start gap-4 p-6 md:flex-row md:items-center", className)} role="status">
      <span
        className="flex size-10 items-center justify-center rounded-xl border border-line-strong bg-surface-2 text-fg-muted"
        aria-hidden
      >
        <RefreshCwIcon className="size-4" />
      </span>
      <div className="flex-1">
        <p className="font-medium text-fg">Plans are loading from the AgentOS API.</p>
        <p className="mt-1 text-sm text-fg-muted">
          The plan catalogue isn&apos;t reachable right now. Check back shortly — or create an account and see your
          workspace&apos;s limits under Billing.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/pricing">Try again</Link>
        </Button>
        <Button asChild variant="primary" size="sm">
          <Link href="/signup">Start building</Link>
        </Button>
      </div>
    </Panel>
  );
}
