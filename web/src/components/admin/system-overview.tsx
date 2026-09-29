"use client";

import { useQuery } from "@tanstack/react-query";
import { CpuIcon, InboxIcon, ListRestartIcon, RefreshCwIcon, WorkflowIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge, LiveDot, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { JsonViewer, MetricCard } from "@/components/ui/data-display";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { adminApi, taskStatusValues, type TaskStatus } from "@/lib/api";
import { durationMs, humanize, number } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { isTaskActive } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { AdminSection } from "./admin-shell";

interface WorkerRow {
  worker_id: string;
  kind: string;
  queues: string[];
  in_flight: number;
  processed: number;
  last_seen_seconds_ago: number;
  alive: boolean;
}
interface QueueRow {
  queue: string;
  status: string;
  count: number;
}

const KNOWN_KEYS = ["workers", "queues", "oldest_pending", "tasks_by_status"];
const JOB_STATUS_ORDER = ["pending", "running", "succeeded", "cancelled", "dead"];

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}
function asRecord(v: unknown): Record<string, number> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};
}

/** Pivot `[{queue, status, count}]` into queue → status → count, with a stable status order. */
export function pivotQueues(rows: QueueRow[]): {
  statuses: string[];
  queues: Array<{ queue: string; counts: Record<string, number>; total: number }>;
} {
  const statuses = [...new Set(rows.map((r) => r.status))].sort((a, b) => {
    const ia = JOB_STATUS_ORDER.indexOf(a);
    const ib = JOB_STATUS_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });
  const map = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const entry = map.get(r.queue) ?? {};
    entry[r.status] = (entry[r.status] ?? 0) + r.count;
    map.set(r.queue, entry);
  }
  const queues = [...map.entries()]
    .map(([queue, counts]) => ({ queue, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => a.queue.localeCompare(b.queue));
  return { statuses, queues };
}

export function SystemOverview() {
  const developerMode = useUiStore((s) => s.developerMode);
  const system = useQuery({
    queryKey: qk.admin.system,
    queryFn: ({ signal }) => adminApi.system({ signal }),
    refetchInterval: 10_000,
  });
  if (system.error) return <ErrorState error={system.error} onRetry={() => void system.refetch()} />;
  if (!system.data) {
    return (
      <div className="flex flex-col gap-6" aria-busy>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }
  const data = system.data;
  const workers = asArray<WorkerRow>(data.workers);
  const queueRows = asArray<QueueRow>(data.queues);
  const oldest = asRecord(data.oldest_pending);
  const tasks = asRecord(data.tasks_by_status);
  const { statuses, queues } = pivotQueues(queueRows);
  const alive = workers.filter((w) => w.alive);
  const pending = queueRows.filter((r) => r.status === "pending").reduce((n, r) => n + r.count, 0);
  const dead = queueRows.filter((r) => r.status === "dead").reduce((n, r) => n + r.count, 0);
  const activeTasks = Object.entries(tasks)
    .filter(([s]) => (taskStatusValues as readonly string[]).includes(s) && isTaskActive(s as TaskStatus))
    .reduce((n, [, c]) => n + c, 0);
  const taskTotal = Object.values(tasks).reduce((a, b) => a + b, 0);
  const extra = Object.fromEntries(Object.entries(data).filter(([k]) => !KNOWN_KEYS.includes(k)));
  const evaluationWorkers = alive.filter((w) => w.queues.length === 1 && w.queues[0] === "evaluation");

  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Workers online"
          value={`${alive.length} / ${workers.length}`}
          icon={<CpuIcon />}
          hint={
            evaluationWorkers.length
              ? `${evaluationWorkers.length} dedicated evaluation worker${evaluationWorkers.length === 1 ? "" : "s"}`
              : "No evaluation worker online"
          }
        />
        <MetricCard
          label="Jobs pending"
          value={number(pending)}
          icon={<InboxIcon />}
          hint={
            Object.keys(oldest).length
              ? `oldest waiting ${durationMs(Math.max(...Object.values(oldest)) * 1000)}`
              : "Nothing waiting"
          }
        />
        <MetricCard
          label="Dead letters"
          value={<span className={dead ? "text-danger" : undefined}>{number(dead)}</span>}
          icon={<ListRestartIcon />}
          hint={
            dead ? (
              <Link href="/app/admin/jobs" className="text-accent hover:underline">
                Review and retry
              </Link>
            ) : (
              "No failed-for-good jobs"
            )
          }
        />
        <MetricCard
          label="Active tasks"
          value={number(activeTasks)}
          icon={<WorkflowIcon />}
          hint={`${number(taskTotal)} tasks in total`}
        />
      </div>

      <AdminSection
        title="Workers"
        description="Heartbeats from worker processes. A worker is online when it reported in the last 60 seconds."
        actions={
          <Button variant="ghost" size="sm" onClick={() => void system.refetch()} loading={system.isFetching}>
            <RefreshCwIcon /> Refresh
          </Button>
        }
      >
        {workers.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<CpuIcon />}
            title="No workers have reported"
            description="Start a worker process; tasks queue until one is running."
            className="rounded-xl border border-line bg-surface-1"
          />
        ) : (
          <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-1">
            <table className="w-full min-w-[720px] text-left text-[13px]">
              <caption className="sr-only">Workers</caption>
              <thead>
                <tr className="border-b border-line text-2xs tracking-wider text-fg-subtle uppercase">
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Worker
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Queues
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    In flight
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Processed
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...workers]
                  .sort(
                    (a, b) => Number(b.alive) - Number(a.alive) || a.last_seen_seconds_ago - b.last_seen_seconds_ago,
                  )
                  .map((w) => (
                    <tr
                      key={w.worker_id}
                      className={cn("border-b border-line last:border-0", !w.alive && "opacity-60")}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <LiveDot tone={w.alive ? "success" : "neutral"} live={w.alive} />
                          <span className="font-mono text-xs text-fg">{w.worker_id}</span>
                          <Badge tone={w.alive ? "success" : "neutral"}>{w.alive ? "Online" : "Offline"}</Badge>
                        </div>
                        <div className="mt-0.5 pl-3.5 text-2xs text-fg-subtle">{humanize(w.kind)}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {w.queues.map((q) => (
                            <span
                              key={q}
                              className={cn(
                                "rounded border px-1.5 py-0.5 font-mono text-2xs",
                                q === "evaluation" ? "border-verify/30 text-verify" : "border-line text-fg-muted",
                              )}
                            >
                              {q}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-fg tabular-nums">{w.in_flight}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-fg-muted tabular-nums">
                        {number(w.processed)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-fg-muted tabular-nums">
                        {durationMs(w.last_seen_seconds_ago * 1000)} ago
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <AdminSection
          title="Job queues"
          description="Jobs by queue and state. Pending jobs wait for a worker serving that queue."
        >
          {queues.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<InboxIcon />}
              title="No jobs recorded"
              className="rounded-xl border border-line bg-surface-1"
            />
          ) : (
            <div className="relative overflow-x-auto rounded-xl border border-line bg-surface-1">
              <table className="w-full text-left text-[13px]">
                <caption className="sr-only">Jobs by queue and status</caption>
                <thead>
                  <tr className="border-b border-line text-2xs tracking-wider text-fg-subtle uppercase">
                    <th scope="col" className="px-4 py-2.5 font-medium">
                      Queue
                    </th>
                    {statuses.map((s) => (
                      <th key={s} scope="col" className="px-3 py-2.5 text-right font-medium">
                        {s}
                      </th>
                    ))}
                    <th scope="col" className="px-4 py-2.5 text-right font-medium">
                      Oldest pending
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {queues.map((q) => (
                    <tr key={q.queue} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2.5 font-mono text-xs font-normal text-fg">
                        {q.queue}
                      </th>
                      {statuses.map((s) => {
                        const n = q.counts[s] ?? 0;
                        return (
                          <td
                            key={s}
                            className={cn(
                              "px-3 py-2.5 text-right font-mono text-xs tabular-nums",
                              n === 0
                                ? "text-fg-subtle/60"
                                : s === "dead" || s === "failed"
                                  ? "text-danger"
                                  : s === "pending"
                                    ? "text-warning"
                                    : "text-fg",
                            )}
                          >
                            {n ? number(n) : "·"}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-fg-muted tabular-nums">
                        {oldest[q.queue] !== undefined ? durationMs(oldest[q.queue] * 1000) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>

        <AdminSection title="Tasks by status" description="Across every organization.">
          <ul className="flex flex-col gap-2 rounded-xl border border-line bg-surface-1 p-4">
            {Object.entries(tasks)
              .sort((a, b) => b[1] - a[1])
              .map(([status, count]) => {
                const known = (taskStatusValues as readonly string[]).includes(status);
                return (
                  <li key={status} className="grid grid-cols-[9.5rem_minmax(0,1fr)_3rem] items-center gap-3">
                    {known ? (
                      <StatusBadge kind="task" value={status as TaskStatus} />
                    ) : (
                      <Badge>{humanize(status)}</Badge>
                    )}
                    <span className="h-1.5 overflow-hidden rounded-full bg-white/[0.05]" aria-hidden>
                      <span
                        className="block h-full rounded-full bg-fg-subtle/60"
                        style={{ width: `${taskTotal ? (count / taskTotal) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="text-right font-mono text-xs text-fg tabular-nums">{number(count)}</span>
                  </li>
                );
              })}
            {taskTotal === 0 && <li className="text-[13px] text-fg-subtle">No tasks yet.</li>}
          </ul>
        </AdminSection>
      </div>

      {Object.keys(extra).length > 0 && (
        <AdminSection title="Other signals" description="Additional fields reported by the backend.">
          {developerMode ? (
            <JsonViewer value={extra} />
          ) : (
            <dl className="grid gap-2 rounded-xl border border-line bg-surface-1 p-4 text-[13px] sm:grid-cols-2">
              {Object.entries(extra).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-fg-muted">{humanize(k)}</dt>
                  <dd className="truncate font-mono text-xs text-fg">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </AdminSection>
      )}
    </div>
  );
}
