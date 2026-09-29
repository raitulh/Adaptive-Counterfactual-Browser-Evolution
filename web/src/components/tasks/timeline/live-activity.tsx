"use client";

/**
 * "What is AgentOS doing right now?" — contextual, never a generic spinner:
 *   planning  → drafting lines that fill in
 *   tool call → the tool's icon with a pulse
 *   verifying → a violet rotating verification ring
 *   waiting   → a steady amber glow (someone must act)
 * Pure: pass the current timeline entry (see `currentActivity`) and the task status.
 */
import { HandIcon, MessageSquareTextIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react";
import type { TaskStatus } from "@/lib/api";
import { taskStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TimelineEntry } from "./normalize";
import { toolActivityVerb, toolIcon } from "./tool-meta";

export interface LiveActivityProps {
  current: TimelineEntry | null;
  status: TaskStatus;
  className?: string;
}

type Mode = "planning" | "tool" | "verify" | "waiting" | "working" | null;

function modeFor(current: TimelineEntry | null, status: TaskStatus): Mode {
  if (current?.state === "waiting") return "waiting";
  if (status === "waiting_approval" || status === "waiting_input" || status === "requires_reconciliation") return "waiting";
  if (current?.kind === "verification" || status === "verifying") return "verify";
  if (current?.kind === "tool_call") return "tool";
  if (status === "planning" || status === "created" || status === "planned" || status === "validating" || current?.kind === "plan") return "planning";
  if (taskStatusMeta[status].live) return "working";
  return null;
}

function PlanningGlyph() {
  return (
    <span className="relative flex size-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10" aria-hidden>
      <span className="flex w-5 flex-col gap-[3px]">
        {[1, 0.7, 0.85].map((w, i) => (
          <span
            key={i}
            className="h-[2px] origin-left rounded-full bg-accent motion-safe:animate-signal"
            style={{ width: `${w * 100}%`, animationDelay: `${i * 0.25}s` }}
          />
        ))}
      </span>
    </span>
  );
}

export function LiveActivity({ current, status, className }: LiveActivityProps) {
  const mode = modeFor(current, status);
  if (!mode) return null;
  const ToolIcon = toolIcon(current?.tool);

  let glyph: React.ReactNode;
  let headline: string;
  let sub: string | null | undefined = null;

  switch (mode) {
    case "planning":
      glyph = <PlanningGlyph />;
      headline = status === "validating" ? "Checking the plan against tools, permissions and policy" : current?.title ?? "Planning";
      sub = status === "validating" ? null : "Understanding the goal and choosing tools";
      break;
    case "tool":
      glyph = (
        <span className="relative flex size-10 items-center justify-center rounded-xl border border-accent/35 bg-accent/10 text-accent" aria-hidden>
          <span className="absolute inset-0 rounded-xl bg-accent/20 motion-safe:animate-pulse-ring" />
          <ToolIcon className="relative size-4.5" />
        </span>
      );
      headline = current?.stepLabel ?? current?.title ?? "Running a tool";
      sub = `${toolActivityVerb(current?.tool)} · ${current?.tool ?? ""}`;
      break;
    case "verify":
      glyph = (
        <span className="relative flex size-10 items-center justify-center rounded-xl border border-verify/35 bg-verify/10 text-verify" aria-hidden>
          <svg viewBox="0 0 44 44" className="absolute -inset-[3px] size-[46px] motion-safe:animate-spin-slow">
            <rect x="1.5" y="1.5" width="41" height="41" rx="12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="9 7" />
          </svg>
          <ShieldCheckIcon className="relative size-4.5" />
        </span>
      );
      headline = current?.kind === "verification" ? current.title : "Verifying every result against the external systems";
      sub = current?.methodLabel ?? "Reading results back before calling anything done";
      break;
    case "waiting": {
      const Icon = current?.kind === "input" || status === "waiting_input" ? MessageSquareTextIcon : HandIcon;
      glyph = (
        <span className="relative flex size-10 items-center justify-center rounded-xl border border-warning/40 bg-warning/10 text-warning shadow-[0_0_24px_-6px_rgb(245_184_74/0.55)]" aria-hidden>
          <Icon className="size-4.5" />
        </span>
      );
      headline = current?.state === "waiting" ? current.title : taskStatusMeta[status].description;
      sub = "AgentOS is paused on this until you act — nothing else runs meanwhile.";
      break;
    }
    default:
      glyph = (
        <span className="relative flex size-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 text-accent" aria-hidden>
          <SparklesIcon className="size-4.5 motion-safe:animate-signal" />
        </span>
      );
      headline = taskStatusMeta[status].description;
      sub = status === "queued" ? "Waiting for the next free worker" : null;
  }

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-surface-1 px-3.5 py-3",
        mode === "waiting" ? "border-warning/30" : mode === "verify" ? "border-verify/25" : "border-accent/20",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      {glyph}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-fg">{headline}</p>
        {sub && <p className="truncate text-xs text-fg-muted">{sub}</p>}
      </div>
    </div>
  );
}
