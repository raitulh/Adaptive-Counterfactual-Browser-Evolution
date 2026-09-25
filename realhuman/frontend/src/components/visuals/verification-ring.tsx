import { LogoMark } from "@/components/ui/logo";
import { cn } from "@/lib/utils/cn";

const TICKS = Array.from({ length: 72 }, (_, i) => i);

/** Large, quiet verification dial used behind the final CTA and on the login screen. */
export function VerificationRing({
  className,
  showMark = false,
}: {
  className?: string;
  showMark?: boolean;
}) {
  return (
    <div aria-hidden className={cn("pointer-events-none relative aspect-square", className)}>
      <svg viewBox="-200 -200 400 400" className="absolute inset-0 size-full overflow-visible">
        <defs>
          <linearGradient id="ring-arc" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-success)" stopOpacity="0" />
            <stop offset="100%" stopColor="var(--color-success)" stopOpacity="0.9" />
          </linearGradient>
        </defs>
        <circle r="196" className="fill-none stroke-border" strokeWidth="1" />
        <circle r="150" className="fill-none stroke-border-strong" strokeWidth="1" />
        <circle r="104" className="fill-none stroke-border" strokeWidth="1" />
        <g className="origin-center animate-spin-slow [transform-box:fill-box]">
          {TICKS.map((tick) => (
            <line
              key={tick}
              x1="0"
              y1={-174}
              x2="0"
              y2={tick % 6 === 0 ? -164 : -169}
              transform={`rotate(${tick * 5})`}
              className="stroke-border-bright"
              strokeWidth="1"
            />
          ))}
        </g>
        <circle
          r="150"
          className="fill-none"
          stroke="url(#ring-arc)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="236 706"
          transform="rotate(-120)"
        />
        <circle cx="0" cy="-150" r="3.5" className="fill-success" transform="rotate(-35)" />
      </svg>
      {showMark ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="inline-flex size-16 items-center justify-center rounded-full border border-border-strong bg-surface/80 text-foreground shadow-elevated backdrop-blur">
            <LogoMark className="size-8" />
          </span>
        </div>
      ) : null}
    </div>
  );
}
