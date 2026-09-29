import { cn } from "@/lib/utils";

/** Small labelled bar for a 0..1 score, with the exact number in mono. */
export function RelevanceMeter({
  value,
  label,
  fraction,
  digits = 2,
  className,
}: {
  /** The number shown. */
  value: number;
  label: string;
  /** Bar fill 0..1 (defaults to `value`). Use a relative fraction for unbounded scores. */
  fraction?: number;
  digits?: number;
  className?: string;
}) {
  const fill = Math.max(0, Math.min(1, fraction ?? value));
  return (
    <span className={cn("inline-flex items-center gap-2", className)} role="img" aria-label={`${label} ${value.toFixed(digits)}`}>
      <span className="text-fg-subtle" aria-hidden>
        {label}
      </span>
      <span className="relative h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
        <span className="absolute inset-y-0 left-0 rounded-full bg-accent/80" style={{ width: `${Math.max(4, fill * 100)}%` }} />
      </span>
      <span className="font-mono tabular-nums text-fg-muted" aria-hidden>
        {value.toFixed(digits)}
      </span>
    </span>
  );
}
