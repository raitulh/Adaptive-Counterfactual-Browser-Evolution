import { CheckIcon, XIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";
import { FILE_STAGES, type FileStage, type StageState } from "./file-status";

const STATE_TEXT: Record<StageState, string> = {
  pending: "not started",
  active: "in progress",
  done: "done",
  failed: "failed",
};

/** Upload → Scan → Extract → Ready, as a compact step indicator (text for screen readers). */
export function FileStages({
  stages,
  size = "sm",
  className,
}: {
  stages: Record<FileStage, StageState>;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <ol className={cn("flex items-center", className)} aria-label="Processing steps">
      {FILE_STAGES.map((s, i) => {
        const state = stages[s.id];
        return (
          <li key={s.id} className={cn("flex items-center", size === "md" && i > 0 && "flex-1")}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "h-px",
                  size === "md" ? "mx-1 min-w-2 flex-1 sm:mx-1.5" : "w-3",
                  state === "pending" ? "bg-white/[0.08]" : state === "failed" ? "bg-danger/50" : "bg-accent/40",
                )}
              />
            )}
            <span className={cn("flex items-center", size === "md" ? "gap-1 sm:gap-1.5" : "gap-1.5")}>
              <span
                aria-hidden
                className={cn(
                  "relative flex shrink-0 items-center justify-center rounded-full border",
                  size === "md" ? "size-5" : "size-3",
                  state === "pending" && "border-line-strong bg-surface-2",
                  state === "active" && "border-accent bg-accent/15",
                  state === "done" &&
                    (s.id === "ready" ? "border-success bg-success" : "border-accent/60 bg-accent/60"),
                  state === "failed" && "border-danger bg-danger",
                )}
              >
                {state === "active" && (
                  <span className="absolute inset-0 rounded-full border border-accent motion-safe:animate-pulse-ring" />
                )}
                {size === "md" && state === "done" && <CheckIcon className="size-3 text-bg" strokeWidth={3} />}
                {size === "md" && state === "failed" && <XIcon className="size-3 text-bg" strokeWidth={3} />}
                {size === "md" && state === "active" && <span className="size-1.5 rounded-full bg-accent" />}
              </span>
              {size === "md" ? (
                <span
                  className={cn(
                    "text-2xs sm:text-xs",
                    state === "pending"
                      ? "text-fg-subtle"
                      : state === "failed"
                        ? "text-danger"
                        : state === "active"
                          ? "text-fg"
                          : "text-fg-muted",
                  )}
                >
                  {s.label}
                  <span className="sr-only">: {STATE_TEXT[state]}</span>
                </span>
              ) : (
                <span className="sr-only">
                  {s.label}: {STATE_TEXT[state]}
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
