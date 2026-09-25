import { Sparkline } from "@/components/visuals/sparkline";
import type { Metric } from "@/lib/schemas/dashboard";
import { cn } from "@/lib/utils/cn";
import { formatDelta, formatInteger } from "@/lib/utils/format";

type Tone = "neutral" | "success" | "warning" | "danger";

const TONE: Record<Tone, string> = {
  neutral: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

interface MetricCardProps {
  label: string;
  metric: Metric;
  trend: readonly number[];
  tone?: Tone;
  /** Whether an increase is good news (affects nothing but the delta's wording). */
  className?: string;
}

export function MetricCard({ label, metric, trend, tone = "neutral", className }: MetricCardProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-surface p-4",
        className,
      )}
    >
      <p className="truncate text-[13px] text-muted">{label}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="font-mono text-xl font-medium tracking-tight tabular-nums sm:text-2xl">
          {formatInteger(metric.value)}
        </p>
        <p className="font-mono text-[11px] text-subtle tabular-nums">
          {formatDelta(metric.delta)}
          <span className="sr-only"> compared with the previous period</span>
        </p>
      </div>
      <Sparkline values={trend} className={TONE[tone]} />
    </div>
  );
}
