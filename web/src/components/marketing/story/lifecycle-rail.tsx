"use client";

import { cn } from "@/lib/utils";
import { useStory } from "./story-stage";

/** The full lifecycle, with the phases each narrative stage covers. */
const PHASES = [
  { id: "GOAL", stage: "goal", tone: "text-accent" },
  { id: "PLAN", stage: "plan", tone: "text-accent" },
  { id: "VALIDATE", stage: "plan", tone: "text-accent" },
  { id: "APPROVE", stage: "act", tone: "text-warning" },
  { id: "EXECUTE", stage: "act", tone: "text-accent" },
  { id: "VERIFY", stage: "verify", tone: "text-verify" },
  { id: "RECOVER", stage: "verify", tone: "text-recover" },
  { id: "COMPLETE", stage: "verify", tone: "text-success" },
  { id: "LEARN", stage: "learn", tone: "text-accent" },
] as const;

const ORDER = ["goal", "plan", "act", "verify", "learn"];

/**
 * GOAL → PLAN → VALIDATE → APPROVE → EXECUTE → VERIFY → RECOVER → COMPLETE → LEARN, highlighted by
 * scroll position. Purely presentational (the chapters carry the same information as text).
 */
export function LifecycleRail({ className }: { className?: string }) {
  const { stage } = useStory();
  const current = ORDER.indexOf(stage);
  return (
    <ol
      aria-label="Task lifecycle"
      className={cn(
        "flex flex-wrap items-center gap-x-1.5 gap-y-1.5 font-mono text-[10px] tracking-[0.14em] uppercase",
        className,
      )}
    >
      {PHASES.map((p, i) => {
        const idx = ORDER.indexOf(p.stage);
        const isActive = idx === current;
        const isPast = current >= 0 && idx < current;
        return (
          <li key={p.id} className="flex items-center gap-2">
            <span
              aria-current={isActive ? "step" : undefined}
              className={cn(
                "transition-colors duration-500",
                isActive ? p.tone : isPast ? "text-fg-muted" : "text-fg-subtle/70",
              )}
            >
              {p.id}
            </span>
            {i < PHASES.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "h-px w-2.5 transition-colors duration-500",
                  isPast || isActive ? "bg-fg-subtle" : "bg-line-strong",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
