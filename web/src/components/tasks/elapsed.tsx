"use client";

import type { TaskOut, TaskStatus } from "@/lib/api";
import { durationMs } from "@/lib/format";
import { useNow } from "./hooks";

/** States after which the clock stops (the backend sets `completed_at` for these). */
const STOPPED: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled", "expired"]);

/**
 * Wall-clock time since the task started (or was created). It keeps ticking while the task is
 * open — including while it waits for you — and stops once it finished, failed, expired or was cancelled.
 */
export function Elapsed({ task, className }: { task: Pick<TaskOut, "status" | "created_at" | "started_at" | "completed_at" | "updated_at">; className?: string }) {
  const stopped = STOPPED.has(task.status);
  const now = useNow(1000, !stopped);
  const start = new Date(task.started_at ?? task.created_at).getTime();
  const end = stopped ? new Date(task.completed_at ?? task.updated_at).getTime() : now;
  const ms = Math.max(0, end - start);
  return (
    <span className={className} title={stopped ? "Total time" : "Elapsed so far"}>
      <span className="tabular-nums" suppressHydrationWarning>
        {durationMs(ms < 1000 ? 0 : ms).replace(/^0ms$/, "0s")}
      </span>
    </span>
  );
}
