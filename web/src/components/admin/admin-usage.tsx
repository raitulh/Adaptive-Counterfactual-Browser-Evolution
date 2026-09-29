"use client";

import { useQuery } from "@tanstack/react-query";
import { GaugeIcon } from "lucide-react";
import * as React from "react";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { adminApi } from "@/lib/api";
import { usd } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { formatMetric, metricMeta } from "@/components/usage/usage-math";
import { useAdminOrganizations } from "./admin-organizations";
import { AdminSection } from "./admin-shell";

interface TenantUsage {
  tenant_id: string;
  usage: Record<string, number>;
  cost_usd: number;
}

const COLUMNS = ["task_created", "model_call", "tool_call", "browser_seconds", "search_query"];

export function AdminUsage() {
  const usage = useQuery({
    queryKey: qk.admin.usage,
    queryFn: ({ signal }) => adminApi.usage({ limit: 200 }, { signal }),
    select: (rows) =>
      rows.map((r): TenantUsage => ({
        tenant_id: String(r.tenant_id ?? ""),
        usage: r.usage && typeof r.usage === "object" ? (r.usage as Record<string, number>) : {},
        cost_usd: typeof r.cost_usd === "number" ? r.cost_usd : 0,
      })),
  });
  const orgs = useAdminOrganizations();
  const org = React.useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o])), [orgs.data]);
  const rows = usage.data ?? [];
  const totalCost = rows.reduce((n, r) => n + r.cost_usd, 0);

  const columns: Column<TenantUsage>[] = [
    {
      id: "org",
      header: "Organization",
      cell: (r) => {
        const o = org.get(r.tenant_id);
        return (
          <div className="min-w-0">
            <div className="truncate text-fg">{o?.name ?? "Unknown organization"}</div>
            <div className="font-mono text-2xs text-fg-subtle">{o ? `${o.plan} plan` : r.tenant_id}</div>
          </div>
        );
      },
    },
    {
      id: "cost",
      header: "Cost",
      className: "text-right",
      cell: (r) => <span className="font-mono text-xs text-fg tabular-nums">{usd(r.cost_usd)}</span>,
    },
    ...COLUMNS.map((k, i): Column<TenantUsage> => ({
      id: k,
      header: metricMeta(k).label,
      className: "text-right",
      hideBelow: i < 2 ? undefined : i < 4 ? "md" : "lg",
      cell: (r) => (
        <span className="font-mono text-xs text-fg-muted tabular-nums">
          {r.usage[k] !== undefined ? formatMetric(k, r.usage[k], { compact: true }) : "·"}
        </span>
      ),
    })),
    {
      id: "other",
      header: "Other",
      hideBelow: "lg",
      cell: (r) => {
        const others = Object.entries(r.usage).filter(([k]) => !COLUMNS.includes(k));
        if (!others.length) return <span className="text-fg-subtle">·</span>;
        return (
          <Tooltip content={others.map(([k, v]) => `${metricMeta(k).label}: ${formatMetric(k, v)}`).join(" · ")}>
            <span
              tabIndex={0}
              className="text-xs text-fg-muted underline decoration-dotted underline-offset-2 outline-none"
            >
              {others.length} more
            </span>
          </Tooltip>
        );
      },
    },
  ];

  return (
    <AdminSection
      title="Usage by organization"
      description={
        <>
          Metered usage for the current calendar month (UTC), ordered by cost.
          {rows.length ? ` Total cost so far: ${usd(totalCost)}.` : ""}
        </>
      }
    >
      <DataTable
        caption="Usage by organization"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.tenant_id}
        isLoading={usage.isLoading}
        error={usage.error}
        onRetry={() => void usage.refetch()}
        empty={
          <EmptyState
            size="sm"
            icon={<GaugeIcon />}
            title="No usage this month"
            description="Metered events from every organization are summarized here."
          />
        }
      />
    </AdminSection>
  );
}
