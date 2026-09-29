"use client";

import { BotIcon, CalendarClockIcon, ListChecksIcon, PauseCircleIcon, ShieldCheckIcon } from "lucide-react";
import * as React from "react";
import { Tooltip } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { browserTimeZone, describeSchedule, formatInZone, nextRuns, validateCron } from "./schedule";

/** Minute-resolution clock so previews stay current without impure calls during render. */
export function useMinuteClock(): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** "Every weekday at 08:00 → creates a task: … → agent → approvals & verification" */
export function ScheduleSentence({
  cron,
  timezone,
  goal,
  agentName,
  className,
}: {
  cron: string;
  timezone: string;
  goal: string;
  agentName?: string | null;
  className?: string;
}) {
  const valid = validateCron(cron);
  const steps = [
    {
      icon: CalendarClockIcon,
      title: valid.ok ? describeSchedule(valid.expression) : "Schedule needs attention",
      detail: timezone.replace(/_/g, " "),
      tone: valid.ok ? "text-accent" : "text-danger",
    },
    {
      icon: ListChecksIcon,
      title: "Creates a task",
      detail: goal.trim()
        ? `“${goal.trim().length > 120 ? `${goal.trim().slice(0, 117)}…` : goal.trim()}”`
        : "Describe the goal below",
      tone: "text-fg-muted",
    },
    {
      icon: BotIcon,
      title: agentName ? `${agentName} plans and executes it` : "Your default agent plans and executes it",
      detail: null,
      tone: "text-fg-muted",
    },
    {
      icon: ShieldCheckIcon,
      title: "Approvals and verification apply as usual",
      detail: "Each run's result lands in Tasks",
      tone: "text-verify",
    },
  ];
  return (
    <ol className={cn("flex flex-col", className)} aria-label="What this automation does">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
            {i < steps.length - 1 && (
              <span aria-hidden className="absolute top-7 bottom-0 left-[13px] w-px bg-line-strong" />
            )}
            <span
              className={cn(
                "relative flex size-7 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface-2",
                s.tone,
              )}
            >
              <Icon className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[13px] leading-snug font-medium text-fg">{s.title}</span>
              {s.detail && (
                <span className="mt-0.5 block text-xs leading-relaxed break-words text-fg-subtle">{s.detail}</span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The next runs on a mini timeline, in the automation's time zone (and yours, if different). */
export function RunTimeline({
  cron,
  timezone,
  count = 7,
  paused,
  className,
}: {
  cron: string;
  timezone: string;
  count?: number;
  paused?: boolean;
  className?: string;
}) {
  const now = useMinuteClock();
  const runs = React.useMemo(() => nextRuns(cron, timezone, count, new Date(now)), [cron, timezone, count, now]);
  const local = React.useMemo(() => browserTimeZone(), []);
  const showLocal = local !== timezone;

  if (runs.length === 0) {
    return (
      <p
        className={cn(
          "rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-xs text-fg-subtle",
          className,
        )}
      >
        Fix the schedule to preview upcoming runs.
      </p>
    );
  }
  const span = Math.max(1, runs[runs.length - 1].getTime() - now);
  const pos = (d: Date) => Math.min(100, Math.max(0, ((d.getTime() - now) / span) * 100));

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {paused && (
        <p className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-fg-muted">
          <PauseCircleIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
          Paused — these runs won&apos;t happen until it&apos;s turned on.
        </p>
      )}
      <div aria-hidden className={cn("relative mx-1.5 h-10", paused && "opacity-50")}>
        <div className="absolute inset-x-0 top-4 h-px bg-line-strong" />
        <div className="absolute top-4 left-0 h-px w-full origin-left bg-gradient-to-r from-accent/70 to-accent/0" />
        <span className="absolute top-[11px] -left-1.5 size-3 rounded-full border-2 border-bg bg-fg-subtle" />
        {runs.map((r, i) => (
          <Tooltip key={r.getTime()} content={`${formatInZone(r, timezone)} · ${relativeTime(r)}`}>
            <span
              className={cn(
                "absolute top-[11px] size-3 -translate-x-1/2 rounded-full border-2 border-bg",
                i === 0 ? "bg-accent shadow-[0_0_0_4px_rgb(92_225_230/0.15)]" : "bg-accent/60",
              )}
              style={{ left: `${pos(r)}%` }}
            />
          </Tooltip>
        ))}
        <span className="absolute top-7 left-0 text-2xs text-fg-subtle">Now</span>
        <span className="absolute top-7 right-0 text-2xs text-fg-subtle">
          {formatInZone(runs[runs.length - 1], timezone, "day")}
        </span>
      </div>
      <ol
        className="flex flex-col divide-y divide-line rounded-lg border border-line"
        aria-label={`Next ${runs.length} runs in ${timezone}`}
      >
        {runs.map((r, i) => (
          <li key={r.getTime()} className="flex items-baseline justify-between gap-3 px-3 py-2 text-xs">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className={cn("w-4 shrink-0 tabular-nums", i === 0 ? "text-accent" : "text-fg-subtle")}>
                {i + 1}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className={cn("tabular-nums", i === 0 ? "font-medium text-fg" : "text-fg-muted")}>
                  {formatInZone(r, timezone)}
                </span>
                {showLocal && (
                  <span className="text-2xs text-fg-subtle tabular-nums">
                    {formatInZone(r, local, "time")} your time
                  </span>
                )}
              </span>
            </span>
            <span className="shrink-0 text-right text-fg-subtle tabular-nums">{relativeTime(r)}</span>
          </li>
        ))}
      </ol>
      <p className="text-2xs leading-relaxed text-fg-subtle">
        Evaluated on the wall clock of {timezone.replace(/_/g, " ")}; daylight-saving changes are handled by the
        scheduler, which is authoritative once saved.
      </p>
    </div>
  );
}
