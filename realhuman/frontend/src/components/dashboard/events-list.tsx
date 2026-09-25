import { OutcomeBadge } from "@/components/ui/status-badge";
import type { VerificationEvent } from "@/lib/schemas/dashboard";
import { cn } from "@/lib/utils/cn";
import { formatScore, formatUtcTime, maskId } from "@/lib/utils/format";

export function EventsList({
  events,
  className,
}: {
  events: readonly VerificationEvent[];
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col divide-y divide-border", className)}>
      {events.map((event) => (
        <li key={event.id} className="flex items-center gap-3 py-3">
          <OutcomeBadge outcome={event.outcome} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[13px]">
              {event.action.replaceAll("_", " ")}{" "}
              <span className="text-subtle">· {event.origin}</span>
            </span>
            <span className="truncate font-mono text-[11px] text-subtle">
              {maskId(event.sessionId)}
            </span>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <span className="font-mono text-xs tabular-nums">{formatScore(event.score)}</span>
            <span className="font-mono text-[11px] text-subtle">
              {formatUtcTime(event.at).replace(" UTC", "")}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
