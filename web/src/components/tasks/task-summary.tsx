"use client";

/**
 * The deterministic execution summary (`GET /tasks/{id}/summary`): built by the backend from
 * recorded steps and verifications only — never model-written, except `direct_response`, which is
 * labelled as not externally verified.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleDashedIcon,
  HandIcon,
  InfoIcon,
  ShieldCheckIcon,
  XIcon,
} from "lucide-react";
import dynamic from "next/dynamic";
import * as React from "react";
import type { StepOut, TaskDetailView, TaskSummaryOut } from "@/lib/api";
import { Skeleton } from "@/components/ui/controls";
import { ErrorState } from "@/components/ui/states";
import { humanizeTool } from "@/lib/format";
import { stepStatusMeta, taskStatusMeta, toneClasses, verificationStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { verificationMethodLabel } from "./timeline/normalize";
import { readable } from "./timeline/readable";

const Markdown = dynamic(() => import("./markdown"), {
  ssr: false,
  loading: () => (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
    </div>
  ),
});

function Section({ title, children, empty }: { title: string; children?: React.ReactNode; empty?: string }) {
  const hasContent = React.Children.toArray(children).filter(Boolean).length > 0;
  if (!hasContent && !empty) return null;
  return (
    <div>
      <h3 className="text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">{title}</h3>
      <div className="mt-1.5">{hasContent ? children : <p className="text-[13px] text-fg-subtle">{empty}</p>}</div>
    </div>
  );
}

function stepName(steps: StepOut[], key: string): string {
  return steps.find((s) => s.step_key === key)?.action ?? key;
}

export interface TaskSummaryProps {
  task: TaskDetailView;
  summary: TaskSummaryOut | undefined;
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  developerMode?: boolean;
}

export function TaskSummary({ task, summary, isLoading, error, onRetry, developerMode }: TaskSummaryProps) {
  const [techOpen, setTechOpen] = React.useState(false);
  if (error && !summary)
    return <ErrorState error={error} onRetry={onRetry} compact title="Couldn't load the summary" />;
  if (isLoading || !summary) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-5" aria-busy>
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  const steps = task.steps.filter((s) => s.plan_version === task.plan_version);
  const status = taskStatusMeta[summary.status];
  const tone = toneClasses[status.tone];

  return (
    <section
      aria-labelledby="summary-title"
      className={cn(
        "rounded-xl border bg-surface-1",
        summary.status === "completed" ? "border-success/25" : "border-line",
      )}
    >
      <div className="flex items-start gap-3 border-b border-line p-4 sm:p-5">
        <span
          className={cn(
            "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
            tone.border,
            tone.soft,
            tone.text,
          )}
          aria-hidden
        >
          {summary.status === "completed" ? (
            <CheckIcon className="size-4" />
          ) : status.tone === "danger" ? (
            <XIcon className="size-4" />
          ) : (
            <InfoIcon className="size-4" />
          )}
        </span>
        <div className="min-w-0">
          <h2 id="summary-title" className="text-[15px] leading-snug font-semibold tracking-tight text-fg">
            {summary.direct_response && summary.what_happened.length === 0 && summary.status === "completed"
              ? "Answered directly — no actions were taken"
              : readable(summary.headline)}
          </h2>
          {summary.partial_completion && (
            <p className="mt-1 text-xs text-recover">
              Partially completed — some changes were made before it stopped. They are listed below.
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-5 p-4 sm:p-5">
        <Section title="What you asked">
          <p className="text-[13px] leading-relaxed text-fg">{task.goal}</p>
        </Section>

        {summary.direct_response && (
          <div className="rounded-lg border border-line bg-surface-2/40 p-4">
            <Markdown>{summary.direct_response}</Markdown>
            <p className="mt-3 flex items-start gap-1.5 border-t border-line pt-2.5 text-xs text-fg-muted">
              <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden />
              {summary.direct_response_note ??
                "Answered by the model without taking any action; not externally verified."}
            </p>
          </div>
        )}

        <Section title="What AgentOS did">
          {summary.what_happened.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {summary.what_happened.map((h) => {
                const m = stepStatusMeta[h.status];
                return (
                  <li key={h.step} className="flex items-start gap-2 text-[13px]">
                    <span
                      className={cn(
                        "mt-0.5 flex size-4 shrink-0 items-center justify-center",
                        toneClasses[m.tone].text,
                      )}
                      aria-hidden
                    >
                      {h.status === "completed" ? (
                        <CheckIcon className="size-3.5" />
                      ) : h.status === "failed" || h.status === "blocked" ? (
                        <XIcon className="size-3.5" />
                      ) : (
                        <CircleDashedIcon className="size-3.5" />
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="text-fg">{h.action}</span>
                      <span className="text-fg-subtle"> · {m.label}</span>
                      {h.summary && <span className="block text-fg-muted">{readable(h.summary)}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="What changed"
          empty={
            summary.status === "completed" || summary.what_happened.length
              ? "Nothing was changed in any external system."
              : undefined
          }
        >
          {summary.what_changed.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {summary.what_changed.map((c) => (
                <li key={c.step} className="rounded-lg border border-line bg-surface-2/40 px-3 py-2 text-[13px]">
                  <p className="text-fg">{readable(c.description) ?? stepName(steps, c.step)}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-fg-subtle">
                    <span>{humanizeTool(c.tool)}</span>
                    {c.external_ref && (
                      <span>
                        ref <code className="font-mono text-2xs break-all text-fg-muted">{c.external_ref}</code>
                      </span>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="What was verified">
          {summary.what_was_verified.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {summary.what_was_verified.map((v) => {
                const m = verificationStatusMeta[v.status];
                const diffs = (v.differences ?? []).filter(Boolean);
                return (
                  <li key={v.step} className="flex items-start gap-2 text-[13px]">
                    <ShieldCheckIcon className={cn("mt-0.5 size-3.5 shrink-0", toneClasses[m.tone].text)} aria-hidden />
                    <span className="min-w-0">
                      <span className="text-fg">{stepName(steps, v.step)}</span>
                      <span className={cn(toneClasses[m.tone].text)}> · {m.label}</span>
                      <span className="block text-xs text-fg-muted">{verificationMethodLabel(v.method)}</span>
                      {diffs.length > 0 && (
                        <span className="block text-xs text-recover">Differences: {diffs.join(", ")}</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section title="What failed">
          {summary.what_failed.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {summary.what_failed.map((f) => (
                <li key={f.step} className="rounded-lg border border-danger/25 bg-danger/[0.04] px-3 py-2 text-[13px]">
                  <p className="text-fg">
                    {stepName(steps, f.step)} <span className="text-fg-subtle">· {stepStatusMeta[f.status].label}</span>
                  </p>
                  {f.message && <p className="mt-0.5 text-fg-muted">{readable(f.message)}</p>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="What remains">
          {summary.waiting_for_user.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {summary.waiting_for_user.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]">
                  <HandIcon className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
                  <span className="text-fg">
                    {w.type === "approval"
                      ? `Your approval: ${readable(w.summary) ?? "an action"}`
                      : w.type === "input"
                        ? `Your answer: ${w.question ?? ""}`
                        : `Confirm the outcome of ${w.step ? stepName(steps, w.step) : "an action"}`}
                    {w.type === "confirm_outcome" && w.message && (
                      <span className="block text-fg-muted">{w.message}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {(summary.what_happened.length > 0 || developerMode) && (
          <div className="border-t border-line pt-3">
            <button
              type="button"
              aria-expanded={techOpen}
              onClick={() => setTechOpen((o) => !o)}
              className="inline-flex items-center gap-1 rounded text-xs text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
            >
              <ChevronRightIcon className={cn("size-3.5 transition-transform", techOpen && "rotate-90")} aria-hidden />
              Technical details
            </button>
            {techOpen && (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-left text-xs">
                  <thead>
                    <tr className="text-2xs tracking-wider text-fg-subtle uppercase">
                      <th className="py-1 pr-3 font-medium">Step</th>
                      <th className="py-1 pr-3 font-medium">Tool</th>
                      <th className="py-1 pr-3 font-medium">Verification</th>
                      <th className="py-1 font-medium">External ref</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono text-2xs text-fg-muted">
                    {steps.map((s) => (
                      <tr key={s.id} className="border-t border-line">
                        <td className="py-1.5 pr-3">{s.step_key}</td>
                        <td className="py-1.5 pr-3">
                          {s.tool_name}@{s.tool_version}
                        </td>
                        <td className="py-1.5 pr-3">
                          {s.verification_method} · {s.verification_status}
                        </td>
                        <td className="max-w-40 truncate py-1.5">{s.external_ref ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
