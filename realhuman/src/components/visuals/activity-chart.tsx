"use client";

import { useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import type { ActivityPoint } from "@/lib/schemas/dashboard";
import { cn } from "@/lib/utils/cn";
import { formatCompact, formatInteger, formatUtcDate } from "@/lib/utils/format";

interface ActivityChartProps {
  data: readonly ActivityPoint[];
  height?: number;
  className?: string;
  /** Accessible title, e.g. "Verification activity, last 14 days". */
  title: string;
}

const PAD = { left: 40, right: 8, top: 10, bottom: 24, gap: 14 };

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exponent = 10 ** Math.floor(Math.log10(value));
  const fraction = value / exponent;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const nice = steps.find((step) => fraction <= step) ?? 10;
  return nice * exponent;
}

/**
 * Two panes sharing one time axis: verified sessions (area) above, flagged
 * sessions (suspicious + blocked, stacked bars) below with their own scale so
 * the smaller series stays readable. Pointer and keyboard (← →) inspection.
 */
export function ActivityChart({ data, height = 280, className, title }: ActivityChartProps) {
  const id = useId();
  const [ref, size] = useElementSize<HTMLDivElement>({ width: 640, height });
  const [active, setActive] = useState<number | null>(null);
  const width = Math.max(size.width, 280);

  const layout = useMemo(() => {
    const innerWidth = width - PAD.left - PAD.right;
    const innerHeight = height - PAD.top - PAD.bottom - PAD.gap;
    const topHeight = innerHeight * 0.68;
    const bottomHeight = innerHeight - topHeight;
    const bottomTop = PAD.top + topHeight + PAD.gap;
    const maxVerified = niceMax(Math.max(...data.map((d) => d.verified)) * 1.08);
    const maxFlagged = niceMax(Math.max(...data.map((d) => d.suspicious + d.blocked)) * 1.1);
    const step = data.length > 1 ? innerWidth / (data.length - 1) : innerWidth;
    const x = (index: number) => PAD.left + index * step;
    const yTop = (value: number) => PAD.top + topHeight - (value / maxVerified) * topHeight;
    const yBottom = (value: number) =>
      bottomTop + bottomHeight - (value / maxFlagged) * bottomHeight;
    return {
      innerWidth,
      topHeight,
      bottomHeight,
      bottomTop,
      maxVerified,
      maxFlagged,
      step,
      x,
      yTop,
      yBottom,
    };
  }, [data, height, width]);

  const line = data
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"}${layout.x(i).toFixed(1)},${layout.yTop(d.verified).toFixed(1)}`,
    )
    .join("");
  const area = `${line}L${layout.x(data.length - 1).toFixed(1)},${(PAD.top + layout.topHeight).toFixed(1)}L${PAD.left},${(PAD.top + layout.topHeight).toFixed(1)}Z`;
  const barWidth = Math.max(3, Math.min(12, layout.step * 0.42));
  const labelEvery = layout.step < 34 ? 3 : layout.step < 56 ? 2 : 1;
  const gridValues = [0.5, 1].map((f) => f * layout.maxVerified);

  function handlePointer(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const relative = event.clientX - rect.left - PAD.left;
    const index = Math.round(relative / layout.step);
    setActive(Math.min(data.length - 1, Math.max(0, index)));
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    const last = data.length - 1;
    const current = active ?? last;
    const next =
      event.key === "ArrowLeft"
        ? current - 1
        : event.key === "ArrowRight"
          ? current + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : null;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, next)));
  }

  const point = active !== null ? data[active] : undefined;
  const tooltipLeft = active !== null ? Math.min(Math.max(layout.x(active), 90), width - 90) : 0;

  return (
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label={`${title}. Use the left and right arrow keys to inspect each day.`}
        onKeyDown={handleKey}
        onFocus={() => setActive((value) => value ?? data.length - 1)}
        onBlur={() => setActive(null)}
        className="relative rounded-md focus-visible:outline-offset-4"
      >
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={title}
          onPointerMove={handlePointer}
          onPointerLeave={() => setActive(null)}
          className="block touch-pan-y select-none"
        >
          <defs>
            <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridValues.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={layout.yTop(value)}
                y2={layout.yTop(value)}
                className="stroke-border"
                strokeDasharray="2 4"
              />
              <text
                x={PAD.left - 8}
                y={layout.yTop(value) + 3}
                textAnchor="end"
                className="fill-subtle font-mono text-[10px]"
              >
                {formatCompact(value)}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={PAD.top + layout.topHeight}
            y2={PAD.top + layout.topHeight}
            className="stroke-border-strong"
          />
          <line
            x1={PAD.left}
            x2={width - PAD.right}
            y1={layout.bottomTop + layout.bottomHeight}
            y2={layout.bottomTop + layout.bottomHeight}
            className="stroke-border-strong"
          />
          <text
            x={PAD.left - 8}
            y={layout.bottomTop + 6}
            textAnchor="end"
            className="fill-subtle font-mono text-[10px]"
          >
            {formatCompact(layout.maxFlagged)}
          </text>

          <path d={area} fill={`url(#${id}-area)`} />
          <path
            d={line}
            fill="none"
            className="stroke-success"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
          />

          {data.map((d, i) => {
            const cx = layout.x(i);
            const blockedTop = layout.yBottom(d.blocked);
            const suspiciousTop = layout.yBottom(d.blocked + d.suspicious);
            return (
              <g
                key={d.date}
                opacity={active === null || active === i ? 1 : 0.45}
                className="transition-opacity duration-150"
              >
                <rect
                  x={cx - barWidth / 2}
                  y={suspiciousTop}
                  width={barWidth}
                  height={Math.max(0, blockedTop - suspiciousTop)}
                  rx="1.5"
                  className="fill-warning/80"
                />
                <rect
                  x={cx - barWidth / 2}
                  y={blockedTop}
                  width={barWidth}
                  height={Math.max(0, layout.bottomTop + layout.bottomHeight - blockedTop)}
                  rx="1.5"
                  className="fill-danger/85"
                />
                {(data.length - 1 - i) % labelEvery === 0 ? (
                  <text
                    x={cx}
                    y={height - 6}
                    textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                    className="fill-subtle font-mono text-[10px]"
                  >
                    {formatUtcDate(d.date)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {point && active !== null ? (
            <g pointerEvents="none">
              <line
                x1={layout.x(active)}
                x2={layout.x(active)}
                y1={PAD.top}
                y2={layout.bottomTop + layout.bottomHeight}
                className="stroke-border-bright"
              />
              <circle
                cx={layout.x(active)}
                cy={layout.yTop(point.verified)}
                r="4"
                className="fill-background stroke-success"
                strokeWidth="2"
              />
            </g>
          ) : null}
        </svg>

        {point ? (
          <div
            aria-live="polite"
            className="pointer-events-none absolute top-1 z-(--z-raised) w-44 -translate-x-1/2 rounded-lg border border-border-strong bg-surface-overlay/95 p-2.5 text-xs shadow-elevated backdrop-blur"
            style={{ left: tooltipLeft }}
          >
            <p className="mb-1.5 font-mono text-[11px] text-subtle">{formatUtcDate(point.date)}</p>
            <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
              <dt className="flex items-center gap-1.5 text-muted">
                <span className="size-1.5 rounded-full bg-success" aria-hidden />
                Verified
              </dt>
              <dd className="text-right font-mono tabular-nums">{formatInteger(point.verified)}</dd>
              <dt className="flex items-center gap-1.5 text-muted">
                <span className="size-1.5 rounded-full bg-warning" aria-hidden />
                Suspicious
              </dt>
              <dd className="text-right font-mono tabular-nums">
                {formatInteger(point.suspicious)}
              </dd>
              <dt className="flex items-center gap-1.5 text-muted">
                <span className="size-1.5 rounded-full bg-danger" aria-hidden />
                Blocked
              </dt>
              <dd className="text-right font-mono tabular-nums">{formatInteger(point.blocked)}</dd>
            </dl>
          </div>
        ) : null}
      </div>

      <div
        className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted"
        aria-hidden
      >
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded bg-success" />
          Verified sessions
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-warning/80" />
          Suspicious
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-[2px] bg-danger/85" />
          Blocked
        </span>
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Verified</th>
            <th scope="col">Suspicious</th>
            <th scope="col">Blocked</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatUtcDate(d.date)}</th>
              <td>{d.verified}</td>
              <td>{d.suspicious}</td>
              <td>{d.blocked}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
