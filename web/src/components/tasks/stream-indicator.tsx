"use client";

import type { StreamState } from "@/lib/realtime/sse";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const COPY: Record<StreamState, { label: string; hint: string; dot: string; pulse?: boolean }> = {
  idle: { label: "Not live", hint: "Live updates are not active for this task.", dot: "bg-fg-subtle" },
  connecting: { label: "Connecting", hint: "Connecting to live updates…", dot: "bg-warning", pulse: true },
  open: { label: "Live", hint: "Receiving live updates as AgentOS works.", dot: "bg-success", pulse: true },
  reconnecting: {
    label: "Reconnecting",
    hint: "Live updates dropped. Reconnecting — nothing is lost: missed events are fetched from the task history.",
    dot: "bg-warning",
    pulse: true,
  },
  ended: {
    label: "Stream ended",
    hint: "The task reached a resting state; live updates ended. Actions you take restart them.",
    dot: "bg-fg-subtle",
  },
  closed: { label: "Not live", hint: "Live updates are closed.", dot: "bg-fg-subtle" },
  failed: {
    label: "Offline",
    hint: "Live updates are unavailable. The page refreshes the task periodically instead.",
    dot: "bg-danger",
  },
};

/** Live / reconnecting / ended — announced politely to screen readers. */
export function StreamIndicator({ state, className }: { state: StreamState; className?: string }) {
  const c = COPY[state];
  return (
    <Tooltip content={c.hint}>
      <span
        role="status"
        aria-live="polite"
        tabIndex={0}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-2xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          className,
        )}
      >
        <span className={cn("size-1.5 rounded-full", c.dot, c.pulse && "motion-safe:animate-signal")} aria-hidden />
        {c.label}
        <span className="sr-only">. {c.hint}</span>
      </span>
    </Tooltip>
  );
}
