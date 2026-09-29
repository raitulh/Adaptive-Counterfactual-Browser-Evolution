"use client";

import { CodeIcon } from "lucide-react";
import * as React from "react";
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";
import {
  INTERVAL_CHOICES,
  SCHEDULE_KINDS,
  WEEKDAYS,
  clock,
  cronToSpec,
  cronToWords,
  defaultSpec,
  specToCron,
  validateCron,
  type ScheduleKind,
  type ScheduleSpec,
} from "./schedule";

export const SCHEDULE_PRESETS: { label: string; spec: ScheduleSpec }[] = [
  { label: "Every weekday at 08:00", spec: { kind: "weekdays", hour: 8, minute: 0 } },
  { label: "Every day at 09:00", spec: { kind: "daily", hour: 9, minute: 0 } },
  { label: "Mondays at 09:00", spec: { kind: "weekly", days: [1], hour: 9, minute: 0 } },
  { label: "Fridays at 16:00", spec: { kind: "weekly", days: [5], hour: 16, minute: 0 } },
  { label: "1st of the month", spec: { kind: "monthly", day: 1, hour: 9, minute: 0 } },
  { label: "Every hour", spec: { kind: "hourly", minute: 0 } },
  { label: "Every 30 minutes", spec: { kind: "interval", every: 30 } },
];

const sameSpec = (a: ScheduleSpec, b: ScheduleSpec) => specToCron(a) === specToCron(b) && a.kind === b.kind;

/**
 * Schedule editor: presets and a structured builder that produce a cron expression, plus an
 * advanced raw cron input with live validation. The editor owns the structured state and reports
 * the resulting expression; it is the only writer of the form's cron value.
 */
export function ScheduleEditor({
  initialCron,
  onChange,
  error,
  describedBy,
  id,
}: {
  initialCron: string;
  onChange: (cron: string) => void;
  error?: string;
  describedBy?: string;
  /** id for the primary control (so an outer label can point at it). */
  id?: string;
}) {
  const [spec, setSpecState] = React.useState<ScheduleSpec>(() => cronToSpec(initialCron));
  const setSpec = (next: ScheduleSpec) => {
    setSpecState(next);
    onChange(specToCron(next));
  };
  const cron = specToCron(spec);
  const idBase = React.useId();
  const kindId = id ?? `${idBase}-kind`;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Schedule presets">
        {SCHEDULE_PRESETS.map((p) => {
          const active = sameSpec(p.spec, spec);
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={active}
              onClick={() => setSpec(p.spec)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50",
                active ? "border-accent/50 bg-accent/10 text-fg" : "border-line bg-surface-1 text-fg-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1/60 p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="flex min-w-44 flex-col gap-1.5">
          <label htmlFor={kindId} className="text-xs text-fg-muted">
            Repeats
          </label>
          <Select value={spec.kind} onValueChange={(k) => setSpec(defaultSpec(k as ScheduleKind, spec))}>
            <SelectTrigger id={kindId} aria-describedby={describedBy}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULE_KINDS.map((k) => (
                <SelectItem key={k.kind} value={k.kind}>
                  {k.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {spec.kind === "interval" && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-xs text-fg-muted">Every</legend>
            <div className="inline-flex rounded-md border border-line-strong p-0.5">
              {INTERVAL_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={spec.every === n}
                  onClick={() => setSpec({ kind: "interval", every: n })}
                  className={cn(
                    "h-7 rounded px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                    spec.every === n ? "bg-surface-3 text-fg" : "text-fg-muted hover:text-fg",
                  )}
                >
                  {n} min
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {spec.kind === "hourly" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-minute`} className="text-xs text-fg-muted">
              At minute
            </label>
            <Select value={String(spec.minute)} onValueChange={(m) => setSpec({ kind: "hourly", minute: Number(m) })}>
              <SelectTrigger id={`${idBase}-minute`} className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    :{String(m).padStart(2, "0")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {spec.kind === "weekly" && (
          <fieldset className="flex flex-col">
            <legend className="mb-1.5 text-xs text-fg-muted">On</legend>
            <div className="flex flex-wrap gap-1">
              {WEEKDAYS.map((d) => {
                const on = spec.days.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    aria-label={d.long}
                    onClick={() => {
                      const days = on ? spec.days.filter((x) => x !== d.value) : [...spec.days, d.value];
                      if (days.length) setSpec({ ...spec, days });
                    }}
                    className={cn(
                      "h-9 w-11 rounded-md border text-[13px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50",
                      on ? "border-accent/50 bg-accent/12 text-fg" : "border-line-strong text-fg-muted hover:text-fg",
                    )}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}

        {spec.kind === "monthly" && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-dom`} className="text-xs text-fg-muted">
              On day
            </label>
            <Select value={String(spec.day)} onValueChange={(d) => setSpec({ ...spec, day: Number(d) })}>
              <SelectTrigger id={`${idBase}-dom`} className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {(spec.kind === "daily" || spec.kind === "weekdays" || spec.kind === "weekly" || spec.kind === "monthly") && (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${idBase}-time`} className="text-xs text-fg-muted">
              At
            </label>
            <Input
              id={`${idBase}-time`}
              type="time"
              step={60}
              value={clock(spec.hour, spec.minute)}
              onChange={(e) => {
                const [h, m] = e.target.value.split(":").map(Number);
                if (Number.isFinite(h) && Number.isFinite(m)) setSpec({ ...spec, hour: h, minute: m });
              }}
              className="w-32 font-mono tabular-nums"
            />
          </div>
        )}

        {spec.kind === "custom" && <CustomCron value={spec.cron} onChange={(c) => setSpec({ kind: "custom", cron: c })} error={error} idBase={idBase} />}

        {spec.kind !== "custom" && (
          <div className="flex items-center gap-2 sm:ml-auto sm:self-center">
            <code className="rounded-md border border-line bg-bg px-2 py-1 font-mono text-xs text-fg-muted" aria-label={`Cron expression ${cron}`}>
              {cron}
            </code>
            <button
              type="button"
              onClick={() => setSpec({ kind: "custom", cron })}
              className="inline-flex items-center gap-1 text-xs text-fg-subtle underline-offset-4 hover:text-fg hover:underline"
            >
              <CodeIcon className="size-3.5" aria-hidden /> Edit as cron
            </button>
          </div>
        )}
      </div>
      {spec.kind !== "custom" && error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      {spec.kind === "monthly" && spec.day > 28 && (
        <p className="text-xs text-fg-subtle">Months without day {spec.day} are skipped.</p>
      )}
    </div>
  );
}

function CustomCron({ value, onChange, error, idBase }: { value: string; onChange: (v: string) => void; error?: string; idBase: string }) {
  const validation = validateCron(value);
  const words = validation.ok ? cronToWords(validation.expression) : null;
  const message = error ?? (validation.ok ? null : validation.error);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      <label htmlFor={`${idBase}-cron`} className="text-xs text-fg-muted">
        Cron expression <span className="text-fg-subtle">(minute hour day-of-month month day-of-week)</span>
      </label>
      <Input
        id={`${idBase}-cron`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        placeholder="0 8 * * 1-5"
        aria-invalid={message ? true : undefined}
        aria-describedby={`${idBase}-cron-help`}
        className="font-mono"
      />
      <p id={`${idBase}-cron-help`} className={cn("text-xs", message ? "text-danger" : "text-fg-muted")} aria-live="polite">
        {message ?? words}
      </p>
    </div>
  );
}
