"use client";

import { CheckIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageState } from "./experiment-state";

/** Horizontal lifecycle stepper; state is conveyed by icon + text, not color alone. */
export function Stepper({
  stages,
  label,
}: {
  stages: Array<{ id: string; label: string; state: StageState }>;
  label: string;
}) {
  return (
    <ol aria-label={label} className="relative flex max-w-full min-w-0 items-center gap-0 overflow-x-auto pb-1">
      {stages.map((s, i) => (
        <li key={s.id} className="flex shrink-0 items-center">
          <div className="flex items-center gap-2" aria-current={s.state === "current" ? "step" : undefined}>
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-2xs",
                s.state === "done" && "border-success/40 bg-success/15 text-success",
                s.state === "current" &&
                  "border-accent/60 bg-accent/15 text-accent shadow-[0_0_0_3px_rgb(92_225_230/0.12)]",
                s.state === "upcoming" && "border-line-strong text-fg-subtle",
                s.state === "failed" && "border-danger/50 bg-danger/15 text-danger",
                s.state === "skipped" && "border-dashed border-line-strong text-fg-subtle/60",
              )}
            >
              {s.state === "done" ? (
                <CheckIcon className="size-3.5" aria-hidden />
              ) : s.state === "failed" ? (
                <XIcon className="size-3.5" aria-hidden />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={cn(
                "text-xs whitespace-nowrap",
                s.state === "current"
                  ? "font-medium text-fg"
                  : s.state === "failed"
                    ? "text-danger"
                    : s.state === "done"
                      ? "text-fg-muted"
                      : "text-fg-subtle",
              )}
            >
              {s.label}
              <span className="sr-only">
                {" "}
                (
                {s.state === "done"
                  ? "done"
                  : s.state === "current"
                    ? "current"
                    : s.state === "failed"
                      ? "stopped here"
                      : s.state === "skipped"
                        ? "not reached"
                        : "upcoming"}
                )
              </span>
            </span>
          </div>
          {i < stages.length - 1 && (
            <span
              aria-hidden
              className={cn("mx-2 h-px w-6 shrink-0 sm:w-10", s.state === "done" ? "bg-success/40" : "bg-line-strong")}
            />
          )}
        </li>
      ))}
    </ol>
  );
}
