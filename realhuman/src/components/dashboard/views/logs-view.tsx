"use client";

import { useMemo, useState } from "react";
import { DataTable, Td, Th, Tr } from "@/components/dashboard/data-table";
import { MockNotice } from "@/components/dashboard/mock-notice";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { HttpStatusBadge } from "@/components/ui/status-badge";
import { useRequestLogs } from "@/hooks/use-dashboard-data";
import { toApiError } from "@/lib/api";
import { cn } from "@/lib/utils/cn";
import { formatUtcTime, maskId } from "@/lib/utils/format";

export function LogsView() {
  const logs = useRequestLogs(30);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const rows = useMemo(
    () => (logs.data ?? []).filter((log) => !errorsOnly || log.status >= 400),
    [logs.data, errorsOnly],
  );

  return (
    <>
      <PageHeader
        title="Logs"
        description="API requests made with this workspace's keys. Request and response bodies are never logged."
        actions={
          <button
            type="button"
            aria-pressed={errorsOnly}
            onClick={() => setErrorsOnly((value) => !value)}
            className={cn(
              "h-8 rounded-lg border px-3 text-[13px] transition-colors",
              errorsOnly
                ? "border-border-bright bg-surface-overlay text-foreground"
                : "border-border text-muted hover:text-foreground",
            )}
          >
            Errors only
          </button>
        }
      />
      <MockNotice />

      {logs.isPending ? (
        <LoadingState rows={10} label="Loading logs" />
      ) : logs.isError ? (
        <ErrorState
          title="Couldn't load logs"
          description={toApiError(logs.error).message}
          onRetry={() => void logs.refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={errorsOnly ? "No failed requests" : "No requests yet"}
          description="Requests appear here as your integration calls the API."
        />
      ) : (
        <DataTable label="API request log">
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Method</Th>
              <Th>Path</Th>
              <Th>Status</Th>
              <Th className="text-right">Latency</Th>
              <Th>Request ID</Th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {rows.map((log) => (
              <Tr key={log.id}>
                <Td>{formatUtcTime(log.at)}</Td>
                <Td className="text-foreground">{log.method}</Td>
                <Td className="text-foreground">{log.path}</Td>
                <Td>
                  <HttpStatusBadge status={log.status} />
                </Td>
                <Td className="text-right tabular-nums">{log.latencyMs}ms</Td>
                <Td>{maskId(log.id)}</Td>
              </Tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </>
  );
}
