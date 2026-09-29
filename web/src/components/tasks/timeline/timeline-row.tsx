"use client";

/**
 * One timeline entry: a node on the rail (its shape and motion say what kind of activity it is and
 * whether it is running, waiting, done or failed — always paired with text) and the human sentence.
 * Pure: everything comes from props.
 */
import {
  CheckCheckIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleDotIcon,
  FlagIcon,
  GaugeIcon,
  HandIcon,
  LifeBuoyIcon,
  ListTreeIcon,
  MessageSquareTextIcon,
  PauseIcon,
  ShieldCheckIcon,
  SkipForwardIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { Badge, RiskBadge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/ui/data-display";
import { clockTime, dateTime, durationMs } from "@/lib/format";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TimelineEntry } from "./normalize";
import { toolIcon } from "./tool-meta";

function entryIcon(entry: TimelineEntry): LucideIcon {
  if (entry.state === "failed" && entry.kind !== "approval") return XIcon;
  if (entry.state === "skipped") return SkipForwardIcon;
  switch (entry.kind) {
    case "tool_call":
      return toolIcon(entry.tool);
    case "verification":
      return ShieldCheckIcon;
    case "plan":
      return ListTreeIcon;
    case "approval":
      return entry.state === "failed" ? XIcon : entry.state === "done" && entry.tone === "success" ? CheckIcon : HandIcon;
    case "input":
      return MessageSquareTextIcon;
    case "recovery":
      return LifeBuoyIcon;
    case "control":
      return PauseIcon;
    case "budget":
      return GaugeIcon;
    case "step":
      return CheckIcon;
    case "task":
      if (entry.phase === "outcome" && entry.tone === "success") return CheckCheckIcon;
      return entry.phase === "planning" ? FlagIcon : CircleDotIcon;
    default:
      return CircleDotIcon;
  }
}

/** The rail node. Distinct, contextual motion: tool pulse, verification ring, planning shimmer, steady waiting glow. */
export function TimelineNode({ entry, className }: { entry: TimelineEntry; className?: string }) {
  const Icon = entryIcon(entry);
  const t = toneClasses[entry.tone];
  const active = entry.state === "active";
  const waiting = entry.state === "waiting";
  const minor = entry.minor || (entry.state === "info" && entry.kind === "task" && entry.phase !== "outcome");
  return (
    <span
      className={cn(
        "relative z-10 flex shrink-0 items-center justify-center rounded-full border bg-surface-1",
        minor ? "size-5" : "size-7",
        entry.state === "skipped" ? "border-dashed border-line-strong text-fg-subtle" : [t.border, t.text],
        (entry.state === "done" || active || waiting) && t.soft,
        waiting && "shadow-[0_0_0_4px_rgb(245_184_74/0.10)]",
        className,
      )}
      aria-hidden
    >
      {active && entry.kind === "verification" ? (
        <svg viewBox="0 0 28 28" className="absolute inset-[-3px] size-[calc(100%+6px)] motion-safe:animate-spin-slow">
          <circle cx="14" cy="14" r="12.5" fill="none" stroke="currentColor" strokeOpacity="0.8" strokeWidth="1.5" strokeDasharray="10 6" />
        </svg>
      ) : active ? (
        <span className={cn("absolute inset-0 rounded-full motion-safe:animate-pulse-ring", t.dot, "opacity-40")} />
      ) : null}
      <Icon className={cn(minor ? "size-2.5" : "size-3.5", active && entry.kind === "plan" && "motion-safe:animate-signal")} strokeWidth={2.2} />
    </span>
  );
}

const STATE_TEXT: Record<TimelineEntry["state"], string> = {
  active: "In progress",
  waiting: "Waiting for you",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
  info: "",
};

export interface TimelineRowProps {
  entry: TimelineEntry;
  /** Draw the rail below the node (false for the last row). */
  connector?: boolean;
  /** Reveal raw event payloads (developer mode). */
  developerMode?: boolean;
  className?: string;
}

export function TimelineRow({ entry, connector = true, developerMode = false, className }: TimelineRowProps) {
  const [open, setOpen] = React.useState(false);
  const minor = entry.minor || (entry.state === "info" && entry.kind === "task" && entry.phase !== "outcome");
  const stateText = STATE_TEXT[entry.state];
  const detailTone =
    entry.state === "failed" ? "text-danger/90" : entry.kind === "verification" && entry.state === "done" ? "text-fg-muted" : "text-fg-muted";

  return (
    <div className={cn("relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3", className)}>
      {connector && <span className="absolute bottom-0 left-[13.5px] top-7 w-px bg-line" aria-hidden />}
      <div className={cn("flex justify-center", minor ? "pt-1" : "pt-0")}>
        <TimelineNode entry={entry} />
      </div>
      <div className={cn("min-w-0", minor ? "pb-3" : "pb-5")}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <p className={cn("min-w-0 break-words", minor ? "text-[12.5px] text-fg-muted" : "text-[13.5px] font-medium leading-snug text-fg")}>
            {entry.title}
            {stateText && <span className="sr-only"> — {stateText}</span>}
          </p>
          {entry.kind === "tool_call" && entry.tool && (
            <code className="rounded border border-line bg-surface-2 px-1.5 py-px font-mono text-2xs text-fg-subtle">{entry.tool}</code>
          )}
          {entry.attempt && entry.attempt > 1 && (
            <Badge tone="recover" variant="outline">
              Attempt {entry.attempt}
            </Badge>
          )}
          {entry.riskLevel && entry.kind === "approval" && entry.state === "waiting" && <RiskBadge level={entry.riskLevel} />}
          {entry.state === "active" && entry.kind === "tool_call" && (
            <span className="text-2xs font-medium text-accent motion-safe:animate-signal">Running</span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-2xs tabular-nums text-fg-subtle">
            {entry.durationMs != null && <span title="Duration">{durationMs(entry.durationMs)}</span>}
            <time dateTime={entry.at} title={dateTime(entry.at)} suppressHydrationWarning>
              {clockTime(entry.at)}
            </time>
          </span>
        </div>

        {entry.kind === "tool_call" && entry.stepLabel && <p className="mt-0.5 text-[13px] leading-snug text-fg-muted">{entry.stepLabel}</p>}
        {entry.kind === "verification" && entry.methodLabel && (
          <p className="mt-0.5 text-xs text-verify/90">
            <ShieldCheckIcon className="mr-1 inline size-3 -translate-y-px" aria-hidden />
            {entry.methodLabel}
          </p>
        )}
        {entry.detail && (
          <p className={cn("mt-1 flex items-start gap-1.5 text-[13px] leading-relaxed", detailTone)}>
            {entry.kind === "tool_call" && entry.state === "done" && <CheckIcon className="mt-[3px] size-3.5 shrink-0 text-accent" aria-hidden />}
            {entry.kind === "tool_call" && entry.state === "failed" && <XIcon className="mt-[3px] size-3.5 shrink-0" aria-hidden />}
            <span className="min-w-0 break-words">{entry.detail}</span>
          </p>
        )}
        {entry.bullets && entry.bullets.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-1 text-[13px] leading-relaxed text-fg">
            {entry.bullets.map((b, i) => (
              <li key={i} className={cn("rounded-md border-l-2 bg-surface-2/60 px-2.5 py-1", toneClasses[entry.tone].border)}>
                {b}
              </li>
            ))}
          </ul>
        )}

        {developerMode && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              className="inline-flex items-center gap-1 rounded text-2xs text-fg-subtle outline-none hover:text-fg-muted focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <ChevronRightIcon className={cn("size-3 transition-transform", open && "rotate-90")} aria-hidden />
              Advanced event data
              <span className="font-mono">
                · seq {entry.events.map((e) => e.seq).join(", ")} · {entry.events.map((e) => e.event_type).join(" → ")}
              </span>
            </button>
            {open && <JsonViewer value={entry.events.length === 1 ? entry.events[0] : entry.events} className="mt-1.5" />}
          </div>
        )}
      </div>
    </div>
  );
}
