"use client";

import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon, ShieldCheckIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/states";
import { adminApi, type AuditOut } from "@/lib/api";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { ActorLabel, AuditDetailSheet } from "@/components/activity/audit-detail-sheet";
import { auditStatusTone } from "@/components/activity/audit-meta";
import { useAdminOrganizations } from "./admin-organizations";
import { AdminSection } from "./admin-shell";

export function AdminSecurityEvents() {
  const events = useQuery({
    queryKey: qk.admin.securityEvents,
    queryFn: ({ signal }) => adminApi.securityEvents({ limit: 200 }, { signal }),
    refetchInterval: 30_000,
  });
  const orgs = useAdminOrganizations();
  const orgName = React.useMemo(() => new Map((orgs.data ?? []).map((o) => [o.id, o.name])), [orgs.data]);
  const [selected, setSelected] = React.useState<AuditOut | null>(null);

  const columns: Column<AuditOut>[] = [
    {
      id: "time",
      header: "When",
      className: "w-28 whitespace-nowrap",
      cell: (e) => <RelativeTime value={e.created_at} className="text-fg-muted" />,
    },
    {
      id: "event",
      header: "Event",
      cell: (e) => (
        <div className="max-w-md min-w-0">
          <div className="truncate font-mono text-[12.5px] text-fg">{e.action}</div>
          {e.result_summary && <div className="truncate text-xs text-fg-subtle">{e.result_summary}</div>}
        </div>
      ),
    },
    {
      id: "status",
      header: "Result",
      cell: (e) => <Badge tone={auditStatusTone(e.status)}>{humanize(e.status)}</Badge>,
    },
    { id: "actor", header: "Actor", hideBelow: "md", cell: (e) => <ActorLabel entry={e} /> },
    {
      id: "org",
      header: "Organization",
      hideBelow: "lg",
      cell: (e) => (
        <span className="text-xs text-fg-muted">
          {e.tenant_id ? (orgName.get(e.tenant_id) ?? `${e.tenant_id.slice(0, 8)}…`) : "Platform"}
        </span>
      ),
    },
    {
      id: "ip",
      header: "IP",
      hideBelow: "lg",
      cell: (e) => <span className="font-mono text-xs text-fg-subtle">{e.ip_address ?? "—"}</span>,
    },
  ];

  return (
    <AdminSection
      title="Security events"
      description="The most recent security-category audit events across all organizations: failed sign-ins, MFA changes, session revocations, account deletions."
      actions={
        <Button variant="ghost" size="sm" onClick={() => void events.refetch()} loading={events.isFetching}>
          <RefreshCwIcon /> Refresh
        </Button>
      }
    >
      <DataTable
        caption="Security events"
        columns={columns}
        rows={events.data ?? []}
        rowKey={(e) => e.id}
        isLoading={events.isLoading}
        error={events.error}
        onRetry={() => void events.refetch()}
        onRowClick={setSelected}
        empty={
          <EmptyState
            size="sm"
            icon={<ShieldCheckIcon />}
            title="No security events recorded"
            description="Security-relevant actions will appear here as they happen."
          />
        }
      />
      <AuditDetailSheet entry={selected} onOpenChange={(o) => !o && setSelected(null)} crossTenant />
    </AdminSection>
  );
}
