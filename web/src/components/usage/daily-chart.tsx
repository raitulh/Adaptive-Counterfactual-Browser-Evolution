"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { formatMetric, niceMax, type DayPoint } from "./usage-math";

const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function label(date: string, long = false) {
  const d = new Date(`${date}T00:00:00Z`);
  return (long ? weekdayFmt : dayFmt).format(d);
}

/**
 * Single-series daily column chart (CSS/SVG, no chart library). Columns ≤ 24px with a 4px rounded
 * cap and a square baseline, hairline gridlines, per-column hover/focus tooltip, and an accessible
 * table view with the same numbers.
 */
export function DailyChart({
  kind,
  points,
  showTable,
  dimmed,
}: {
  kind: string;
  points: DayPoint[];
  showTable: boolean;
  dimmed?: boolean;
}) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const ticks = [max, max / 2, 0];
  const total = points.reduce((s, p) => s + p.value, 0);
  const peak = points.reduce<DayPoint | null>((best, p) => (p.value > (best?.value ?? 0) ? p : best), null);

  if (showTable) {
    return (
      <div className="max-h-80 overflow-y-auto rounded-lg border border-line">
        <table className="w-full text-left text-[13px]">
          <caption className="sr-only">Daily usage</caption>
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th scope="col" className="px-3 py-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase">
                Day (UTC)
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-2xs font-medium tracking-wider text-fg-subtle uppercase"
              >
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.date} className="border-t border-line">
                <td className="px-3 py-1.5 text-fg-muted">{label(p.date, true)}</td>
                <td className="px-3 py-1.5 text-right text-fg tabular-nums">{formatMetric(kind, p.value)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line-strong">
              <th scope="row" className="px-3 py-2 font-medium text-fg">
                Total
              </th>
              <td className="px-3 py-2 text-right font-medium text-fg tabular-nums">{formatMetric(kind, total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  }

  const tip = active !== null ? points[active] : null;
  const labelEvery = points.length > 20 ? 7 : points.length > 10 ? 3 : 1;

  return (
    <div className={cn("transition-opacity", dimmed && "opacity-60")}>
      <div className="flex gap-3">
        {/* y axis */}
        <div
          className="relative flex h-48 w-12 shrink-0 flex-col justify-between text-right text-2xs text-fg-subtle tabular-nums"
          aria-hidden
        >
          {ticks.map((t) => (
            <span key={t} className="-translate-y-1/2 first:translate-y-0 last:translate-y-0">
              {formatMetric(kind, t, { compact: true })}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* gridlines */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48" aria-hidden>
            {ticks.map((t, i) => (
              <div
                key={t}
                className="absolute inset-x-0 h-px bg-line"
                style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
              />
            ))}
          </div>
          <ul
            className="relative flex h-48 items-end gap-[2px]"
            aria-label={`Daily ${kind} values`}
            onMouseLeave={() => setActive(null)}
          >
            {points.map((p, i) => {
              const h = max > 0 ? (p.value / max) * 100 : 0;
              return (
                <li key={p.date} className="flex h-full min-w-0 flex-1 justify-center">
                  <button
                    type="button"
                    className="group relative flex h-full w-full max-w-10 items-end justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
                    onMouseEnter={() => setActive(i)}
                    onFocus={() => setActive(i)}
                    onBlur={() => setActive(null)}
                    aria-label={`${label(p.date, true)}: ${formatMetric(kind, p.value)}`}
                  >
                    <span
                      className={cn(
                        "block w-full max-w-6 rounded-t-[4px] transition-[height,background-color] duration-300",
                        p.value > 0 ? (active === i ? "bg-accent-strong" : "bg-accent") : "bg-transparent",
                      )}
                      style={{ height: p.value > 0 ? `max(2px, ${h}%)` : 0 }}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
          {/* x labels */}
          <div className="mt-2 flex gap-[2px] text-2xs text-fg-subtle" aria-hidden>
            {points.map((p, i) => (
              <span key={p.date} className="min-w-0 flex-1 text-center whitespace-nowrap">
                {i % labelEvery === 0 ? label(p.date) : ""}
              </span>
            ))}
          </div>
          {tip && active !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line-strong bg-surface-4 px-2.5 py-1.5 text-xs shadow-float"
              style={{ left: `${((active + 0.5) / points.length) * 100}%` }}
            >
              <div className="font-semibold text-fg tabular-nums">{formatMetric(kind, tip.value)}</div>
              <div className="whitespace-nowrap text-fg-muted">{label(tip.date, true)}</div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-3 text-xs text-fg-subtle">
        {formatMetric(kind, total)} this period
        {peak ? ` · busiest day ${label(peak.date)} (${formatMetric(kind, peak.value)})` : ""}
      </p>
    </div>
  );
}
