"use client";

import { Check, RotateCcw } from "lucide-react";
import { FINAL_PHASE, HERO_SEQUENCE } from "@/components/visuals/hero-sequence";
import { cn } from "@/lib/utils/cn";

interface SequencePanelProps {
  phase: number;
  canReplay: boolean;
  onReplay: () => void;
  className?: string;
}

/** Monospace system readout that narrates the hero visual's state changes. */
export function SequencePanel({ phase, canReplay, onReplay, className }: SequencePanelProps) {
  const verified = phase >= FINAL_PHASE;
  const steps = HERO_SEQUENCE.slice(0, FINAL_PHASE);
  const status = verified ? "verified" : phase === 0 ? "unverified" : "analyzing";

  return (
    <div
      className={cn(
        "w-full max-w-[17.5rem] rounded-xl border bg-surface/80 p-3.5 font-mono text-[11.5px] shadow-elevated backdrop-blur-xl transition-[border-color,box-shadow] duration-700",
        verified ? "border-success/30 shadow-glow-success" : "border-border-strong",
        className,
      )}
    >
      <p className="sr-only">
        Illustration: an anonymous session is analyzed across several signals and marked human
        verified.
      </p>
      <div aria-hidden>
        <div className="mb-3 flex items-center justify-between gap-3 border-b border-border pb-2.5">
          <span className="text-subtle">
            session <span className="text-muted">sess_7f3a…41d8</span>
          </span>
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[10px] tracking-wider uppercase transition-colors duration-500",
              verified && "bg-success/12 text-success",
              status === "analyzing" && "bg-accent/12 text-accent",
              status === "unverified" && "bg-surface-overlay text-subtle",
            )}
          >
            {status}
          </span>
        </div>

        <ol className="flex flex-col gap-1.5">
          {steps.map((step, index) => {
            const done = phase > index;
            const current = phase === index && !verified;
            return (
              <li key={step.label} className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "inline-flex size-3.5 items-center justify-center rounded-full border transition-colors duration-500",
                    done && !verified && "border-accent/50 bg-accent/15 text-accent",
                    done && verified && "border-success/50 bg-success/15 text-success",
                    current && "border-accent/60",
                    !done && !current && "border-border-strong",
                  )}
                >
                  {done ? (
                    <Check className="size-2.5" strokeWidth={3} />
                  ) : current ? (
                    <span className="size-1 animate-pulse-soft rounded-full bg-accent" />
                  ) : null}
                </span>
                <span
                  className={cn(
                    "flex-1 transition-colors duration-500",
                    done || current ? "text-foreground" : "text-subtle",
                  )}
                >
                  {step.label}
                </span>
                {index === 4 ? (
                  <span className="flex items-center gap-1.5">
                    <span className="relative h-1 w-10 overflow-hidden rounded-full bg-surface-overlay">
                      <span
                        className={cn(
                          "absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-out-expo",
                          verified ? "bg-success" : "bg-accent",
                        )}
                        style={{ width: phase >= 4 ? "93%" : "0%" }}
                      />
                    </span>
                    <span className={cn("tabular-nums", phase >= 4 ? "text-muted" : "text-subtle")}>
                      {phase >= 4 ? "0.93" : "—"}
                    </span>
                  </span>
                ) : (
                  <span className="text-subtle">{done ? step.detail : ""}</span>
                )}
              </li>
            );
          })}
        </ol>

        <div
          className={cn(
            "mt-3 flex items-center gap-2 rounded-md border px-2.5 py-2 text-[11px] font-medium tracking-[0.14em] uppercase transition-all duration-700",
            verified
              ? "border-success/30 bg-success/10 text-success"
              : "border-dashed border-border-strong text-subtle",
          )}
        >
          <Check className="size-3.5" strokeWidth={3} />
          Human verified
          <span className="ml-auto text-[10px] tracking-normal normal-case opacity-80">
            {verified ? "demo" : ""}
          </span>
        </div>
      </div>

      {canReplay ? (
        <button
          type="button"
          onClick={onReplay}
          className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-subtle transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-3" aria-hidden />
          Replay sequence
        </button>
      ) : null}
    </div>
  );
}
