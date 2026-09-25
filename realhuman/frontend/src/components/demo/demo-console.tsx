"use client";

import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { CodeBlock } from "@/components/ui/code-block";
import { SignalBadge } from "@/components/ui/status-badge";
import type { DemoState, LogTone } from "@/lib/demo/machine";
import { cn } from "@/lib/utils/cn";
import { formatOffset, formatScore, maskId, maskSecret } from "@/lib/utils/format";
import { SIGNALS } from "@/lib/verification/signals";

const TONE_CLASS: Record<LogTone, string> = {
  neutral: "text-muted",
  accent: "text-accent",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

interface DemoConsoleProps {
  state: DemoState;
  modeLabel: string;
  className?: string;
}

/** Developer-side view of the same verification: signals, decision and event log. */
export function DemoConsole({ state, modeLabel, className }: DemoConsoleProps) {
  const logRef = useRef<HTMLOListElement>(null);
  const verified = state.status === "verified";

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.log.length]);

  const resultJson = state.result
    ? JSON.stringify(
        {
          session: state.result.sessionId,
          verified: state.result.verified,
          decision: state.result.decision,
          risk: state.result.risk,
          score: state.result.score,
          token: state.result.token ? maskSecret(state.result.token) : null,
        },
        null,
        2,
      )
    : null;

  return (
    <div className={cn("flex min-w-0 flex-col bg-background/40", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <p className="text-[13px] font-medium">Verification console</p>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-subtle">
            {state.session ? maskId(state.session.id) : "no session"}
          </span>
          <Badge tone="neutral" size="sm" dot>
            {modeLabel}
          </Badge>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-5">
        <section aria-label="Signals" className="flex flex-col gap-2.5">
          {SIGNALS.map((definition) => {
            const signal = state.signals.find((s) => s.id === definition.id);
            const waiting = state.status === "analyzing" && !signal;
            return (
              <div
                key={definition.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5"
              >
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[13px]">{definition.label}</span>
                  <span className="hidden truncate font-mono text-[10.5px] text-subtle sm:inline">
                    {definition.key}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-8 text-right font-mono text-[11px] text-muted tabular-nums">
                    {signal ? formatScore(signal.score) : "—"}
                  </span>
                  {signal ? (
                    <SignalBadge status={signal.status} />
                  ) : (
                    <Badge size="sm" tone="neutral" className={cn(waiting && "animate-pulse-soft")}>
                      {waiting ? "Pending" : "Idle"}
                    </Badge>
                  )}
                </div>
                <div className="col-span-2 h-1 overflow-hidden rounded-full bg-surface-overlay">
                  <div
                    className={cn(
                      "h-full rounded-full transition-[width,background-color] duration-700 ease-out-expo",
                      verified
                        ? "bg-success"
                        : signal?.status === "review"
                          ? "bg-warning"
                          : signal?.status === "fail"
                            ? "bg-danger"
                            : "bg-accent",
                    )}
                    style={{ width: signal ? `${signal.score * 100}%` : "0%" }}
                  />
                </div>
              </div>
            );
          })}
        </section>

        <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-3.5 py-2.5">
          <span className="text-[13px] text-muted">
            Aggregate <span className="text-subtle">(demo signal)</span>
          </span>
          <span
            className={cn(
              "font-mono text-sm tabular-nums transition-colors duration-500",
              verified ? "text-success" : state.result ? "text-warning" : "text-subtle",
            )}
          >
            {state.result ? `${formatScore(state.result.score)} · ${state.result.decision}` : "—"}
          </span>
        </div>

        <section aria-label="Event log">
          <p className="mb-2 eyebrow">Events</p>
          <ol
            ref={logRef}
            className="h-36 overflow-y-auto rounded-lg border border-border bg-surface/60 p-3 font-mono text-[11px] leading-relaxed"
          >
            {state.log.length === 0 ? (
              <li className="text-subtle">Waiting for a verification to start…</li>
            ) : (
              state.log.map((entry) => (
                <li key={entry.id} className="flex gap-3">
                  <span className="w-14 shrink-0 text-right text-subtle tabular-nums">
                    {formatOffset(entry.offsetMs)}
                  </span>
                  <span className={cn("shrink-0", TONE_CLASS[entry.tone])}>{entry.event}</span>
                  {entry.detail ? (
                    <span className="truncate text-subtle">{entry.detail}</span>
                  ) : null}
                </li>
              ))
            )}
          </ol>
        </section>

        {resultJson ? (
          <section
            aria-label="Result payload"
            className="overflow-hidden rounded-lg border border-border bg-surface/60"
          >
            <p className="border-b border-border px-3 py-2 font-mono text-[11px] text-subtle">
              result · token masked
            </p>
            <CodeBlock
              code={resultJson}
              language="json"
              label="Verification result"
              showLineNumbers={false}
              className="py-3 text-[11.5px]"
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}
