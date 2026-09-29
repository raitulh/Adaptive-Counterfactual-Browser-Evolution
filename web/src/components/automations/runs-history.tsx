"use client";

import { ArrowUpRightIcon, HistoryIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge, DataTable, EmptyState, IdChip, LiveDot, RelativeTime, Tooltip, type Column } from "@/components/ui";
import type { AutomationRunOut } from "@/lib/api";
import { dateTime, duration } from "@/lib/format";
import { useUiStore } from "@/stores/ui";
import { describeRunError, presentRun } from "./automation-status";
import { useAutomationRuns } from "./hooks";
import { formatInZone } from "./schedule";

export function RunsHistory({ automationId, timezone, action }: { automationId: string; timezone: string; action?: React.ReactNode }) {
  const runs = useAutomationRuns(automationId);
  const router = useRouter();
  const developerMode = useUiStore((s) => s.developerMode);
  const openCount = runs.items.filter((r) => presentRun(r).open).length;

  const columns: Column<AutomationRunOut>[] = [
    {
      id: "status",
      header: "Status",
      cell: (r) => {
        const p = presentRun(r);
        const err = describeRunError(r.error);
        return (
          <div className="flex flex-col items-start gap-1">
            <Tooltip content={p.description}>
              <Badge tone={p.tone} tabIndex={0}>
                <LiveDot tone={p.tone} live={Boolean(p.live)} />
                {p.label}
              </Badge>
            </Tooltip>
            {err && r.status !== "succeeded" && (
              <span className={p.open ? "text-xs text-fg-muted" : "text-xs text-danger/90"}>
                {err}
                {p.open && r.next_attempt_at && (
                  <>
                    {" "}
                    · retry <RelativeTime value={r.next_attempt_at} />
                  </>
                )}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "trigger",
      header: "Trigger",
      hideBelow: "sm",
      cell: (r) => <span className="text-fg-muted">{r.trigger === "manual" ? "Run now" : "Schedule"}</span>,
    },
    {
      id: "scheduled",
      header: "Scheduled for",
      cell: (r) => (
        <Tooltip content={`${dateTime(r.scheduled_for)} (your time)`}>
          <span tabIndex={0} className="flex flex-col outline-none">
            <span className="tabular-nums text-fg">{formatInZone(new Date(r.scheduled_for), timezone)}</span>
            <span className="text-xs text-fg-subtle">
              <RelativeTime value={r.scheduled_for} />
            </span>
          </span>
        </Tooltip>
      ),
    },
    {
      id: "duration",
      header: "Duration",
      hideBelow: "md",
      cell: (r) => (
        <span className="tabular-nums text-fg-muted">{r.finished_at ? duration(r.created_at, r.finished_at) : presentRun(r).open ? "In progress" : "—"}</span>
      ),
    },
    { id: "attempts", header: "Attempts", hideBelow: "lg", cell: (r) => <span className="tabular-nums text-fg-muted">{r.attempts}</span> },
    {
      id: "task",
      header: "Task",
      className: "text-right",
      cell: (r) =>
        r.task_id ? (
          <Link
            href={`/app/tasks/${r.task_id}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-fg-muted hover:text-fg"
          >
            Open task <ArrowUpRightIcon className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <span className="text-xs text-fg-subtle">No task</span>
        ),
    },
    ...(developerMode ? [{ id: "id", header: "Run", hideBelow: "lg" as const, cell: (r: AutomationRunOut) => <IdChip id={r.id} label="run" /> }] : []),
  ];

  return (
    <section aria-labelledby="runs-title" className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="runs-title" className="text-sm font-semibold tracking-tight text-fg">
            Runs
          </h2>
          <p className="mt-0.5 text-[13px] text-fg-muted" aria-live="polite">
            {openCount > 0 ? `${openCount} in progress — updating live.` : "Newest first. Each run links to the task it created."}
          </p>
        </div>
        {action}
      </div>
      <DataTable
        caption="Automation runs"
        columns={columns}
        rows={runs.items}
        rowKey={(r) => r.id}
        isLoading={runs.isPending}
        error={runs.error}
        onRetry={() => void runs.refetch()}
        onRowClick={(r) => r.task_id && router.push(`/app/tasks/${r.task_id}`)}
        hasMore={runs.hasNextPage}
        onLoadMore={() => void runs.fetchNextPage()}
        isLoadingMore={runs.isFetchingNextPage}
        empty={
          <EmptyState
            size="sm"
            icon={<HistoryIcon />}
            title="No runs yet"
            description="Runs appear here when the schedule fires — or right away with “Run now”."
          />
        }
      />
    </section>
  );
}
