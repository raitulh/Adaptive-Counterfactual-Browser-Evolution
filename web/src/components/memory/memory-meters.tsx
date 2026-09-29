"use client";

import * as React from "react";
import { Tooltip } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { confidenceLevel, formatDays, freshnessWindow, pct, type FreshnessMeta } from "./presentation";

const RING_STROKE: Record<Tone, string> = {
  accent: "stroke-accent",
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  info: "stroke-info",
  verify: "stroke-verify",
  recover: "stroke-recover",
  neutral: "stroke-fg-muted",
};

/** Circular confidence meter with the value in the middle. Text label is rendered alongside. */
export function ConfidenceRing({ value, size = 34, className }: { value: number; size?: number; className?: string }) {
  const level = confidenceLevel(value);
  const r = (size - 5) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="stroke-white/[0.07]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={`${c * clamped} ${c}`}
          className={cn(RING_STROKE[level.tone], "transition-[stroke-dasharray] duration-500 ease-out")}
        />
      </svg>
      <span className="absolute text-[10px] font-semibold text-fg tabular-nums">{Math.round(clamped * 100)}</span>
    </span>
  );
}

export function ConfidenceMeter({ value, compact }: { value: number; compact?: boolean }) {
  const level = confidenceLevel(value);
  return (
    <Tooltip content={`${level.label}: ${pct(value)}. AgentOS is ${pct(value)} sure this is true.`}>
      <span
        className="inline-flex items-center gap-2 outline-none"
        tabIndex={0}
        role="img"
        aria-label={`Confidence ${pct(value)} (${level.label.toLowerCase()})`}
      >
        <ConfidenceRing value={value} size={compact ? 28 : 34} />
        {!compact && (
          <span className="flex flex-col leading-tight">
            <span className="text-2xs tracking-wider text-fg-subtle uppercase">Confidence</span>
            <span className={cn("text-xs font-medium", toneClasses[level.tone].text)}>
              {level.label.replace(" confidence", "")}
            </span>
          </span>
        )}
      </span>
    </Tooltip>
  );
}

/** Five-segment importance meter. */
export function ImportanceMeter({ value, className }: { value: number; className?: string }) {
  const filled = Math.max(0, Math.min(5, Math.round(value * 5)));
  return (
    <Tooltip content={`Importance ${pct(value)} — how useful this is for future tasks.`}>
      <span
        className={cn("inline-flex flex-col gap-1 outline-none", className)}
        tabIndex={0}
        role="img"
        aria-label={`Importance ${pct(value)}`}
      >
        <span className="text-2xs tracking-wider text-fg-subtle uppercase">Importance</span>
        <span className="flex items-center gap-0.5" aria-hidden>
          {Array.from({ length: 5 }).map((_, i) => (
            <span key={i} className={cn("h-1.5 w-3.5 rounded-full", i < filled ? "bg-fg-muted" : "bg-white/[0.07]")} />
          ))}
          <span className="ml-1.5 text-xs text-fg-muted tabular-nums">{pct(value)}</span>
        </span>
      </span>
    </Tooltip>
  );
}

/**
 * Freshness window: how much of the type's re-verification window has elapsed. The backend's
 * freshness label is authoritative; the bar only visualizes the time since verification.
 */
export function FreshnessMeter({
  memoryType,
  lastVerifiedAt,
  freshness,
  now,
  className,
}: {
  memoryType: string;
  lastVerifiedAt: string;
  freshness: FreshnessMeta;
  now: number;
  className?: string;
}) {
  const w = freshnessWindow(memoryType, lastVerifiedAt, now);
  const used = freshness.label === "Stale" ? 1 : w.used;
  const hint =
    freshness.label === "Fresh"
      ? `Re-verify within ${formatDays(w.remainingDays)} to keep it fresh.`
      : freshness.label === "Stale"
        ? `Older than its ${formatDays(w.maxAgeDays)} freshness window. Verify it if it's still true.`
        : "Low confidence or conflicting. Verify it if it's true.";
  return (
    <Tooltip content={hint}>
      <span className={cn("inline-flex min-w-0 flex-col gap-1 outline-none", className)} tabIndex={0}>
        <span className="text-2xs tracking-wider text-fg-subtle uppercase">Freshness</span>
        <span className="flex items-center gap-2">
          <span
            className={cn(
              "relative h-1.5 w-20 overflow-hidden rounded-full bg-white/[0.07]",
              freshness.label === "Unverified" &&
                "bg-[repeating-linear-gradient(135deg,rgb(255_255_255/0.08)_0_3px,transparent_3px_6px)]",
            )}
            role="meter"
            aria-label="Freshness window used"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(used * 100)}
            aria-valuetext={`${freshness.label}. Verified ${relativeTime(lastVerifiedAt)}. ${hint}`}
          >
            <span
              className={cn(
                "absolute inset-y-0 left-0 rounded-full",
                toneClasses[freshness.tone].bg,
                freshness.label !== "Fresh" && "opacity-80",
              )}
              style={{ width: `${Math.max(4, used * 100)}%` }}
            />
          </span>
          <span className={cn("text-xs font-medium", toneClasses[freshness.tone].text)}>{freshness.label}</span>
        </span>
      </span>
    </Tooltip>
  );
}

/** A clock that ticks once a minute — for freshness math without impure calls during render. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Relevance score bar (0..1) for recall results. */
export function ScoreMeter({ value, label = "Match" }: { value: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <span className="inline-flex flex-col gap-1" role="img" aria-label={`${label} score ${v.toFixed(2)}`}>
      <span className="text-2xs tracking-wider text-fg-subtle uppercase">{label}</span>
      <span className="flex items-center gap-2" aria-hidden>
        <span className="relative h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.07]">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-accent"
            style={{ width: `${Math.max(4, v * 100)}%` }}
          />
        </span>
        <span className="font-mono text-xs text-fg-muted tabular-nums">{v.toFixed(2)}</span>
      </span>
    </span>
  );
}
