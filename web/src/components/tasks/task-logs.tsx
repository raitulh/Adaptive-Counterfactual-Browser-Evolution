"use client";

/** User-safe execution log (`GET /tasks/{id}/logs`), virtualized when long. */
import { useVirtualizer } from "@tanstack/react-virtual";
import { ScrollTextIcon } from "lucide-react";
import * as React from "react";
import type { ExecutionLogOut, StepOut } from "@/lib/api";
import { Skeleton } from "@/components/ui/controls";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { clockTime, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEVEL: Record<string, string> = {
  error: "text-danger border-danger/30 bg-danger/10",
  warning: "text-warning border-warning/30 bg-warning/10",
  info: "text-fg-muted border-line-strong bg-white/[0.03]",
  debug: "text-fg-subtle border-line bg-transparent",
};

function LogLine({ log, stepLabel }: { log: ExecutionLogOut; stepLabel?: string }) {
  return (
    <div className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-start gap-x-3 border-b border-line px-3 py-2 text-[13px] last:border-0">
      <time
        dateTime={log.created_at}
        title={dateTime(log.created_at)}
        className="pt-px font-mono text-2xs text-fg-subtle tabular-nums"
      >
        {clockTime(log.created_at)}
      </time>
      <span
        className={cn(
          "mt-px rounded border px-1.5 font-mono text-[10px] leading-4 uppercase",
          LEVEL[log.level] ?? LEVEL.info,
        )}
      >
        {log.level}
      </span>
      <div className="min-w-0">
        <p className="leading-relaxed break-words text-fg">{log.message}</p>
        {stepLabel && <p className="truncate text-xs text-fg-subtle">{stepLabel}</p>}
      </div>
    </div>
  );
}

export function TaskLogs({
  logs,
  steps,
  isLoading,
  error,
  onRetry,
}: {
  logs: ExecutionLogOut[] | undefined;
  steps: StepOut[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const labels = React.useMemo(() => new Map(steps.map((s) => [s.id, `Step ${s.position + 1}: ${s.action}`])), [steps]);
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rows = logs ?? [];
  const virtual = rows.length > 200;
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is designed for this usage
  const virtualizer = useVirtualizer({
    count: virtual ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52,
    overscan: 10,
  });

  if (error && !logs) return <ErrorState error={error} onRetry={onRetry} compact title="Couldn't load the log" />;
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-1 p-3" aria-busy>
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<ScrollTextIcon />}
        title="No log lines yet"
        description="Execution notes appear here as AgentOS runs steps."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
      {virtual ? (
        <div ref={parentRef} className="max-h-[70vh] overflow-y-auto" tabIndex={0} aria-label="Execution log">
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => (
              <div
                key={item.key}
                data-index={item.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full"
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <LogLine
                  log={rows[item.index]}
                  stepLabel={rows[item.index].step_id ? labels.get(rows[item.index].step_id!) : undefined}
                />
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div role="log" aria-label="Execution log">
          {rows.map((log, i) => (
            <LogLine key={i} log={log} stepLabel={log.step_id ? labels.get(log.step_id) : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
