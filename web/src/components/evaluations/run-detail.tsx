"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRightIcon, FlaskConicalIcon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { IdChip, JsonViewer, KeyValue } from "@/components/ui/data-display";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toast, toastError } from "@/components/ui/toaster";
import {
  evaluationsApi,
  newIdempotencyKey,
  type EvaluationResultOut,
  type EvaluationRunDetail,
  type StrategyConfig,
} from "@/lib/api";
import { dateTime, duration, durationMs, humanize, humanizeTool, usd } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { CheckMark, EvaluationWorkerNotice, LabHeader, LabPanel, LabShell, LabStatusBadge, Readout } from "./lab";
import { num, pct, RUN_STATUS, statusMeta } from "./lab-status";

export function RunDetail({ runId }: { runId: string }) {
  const run = useQuery({
    queryKey: qk.evaluations.detail(runId),
    queryFn: ({ signal }) => evaluationsApi.get(runId, { signal }),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.status === "queued" || q.state.data.status === "running") ? 3000 : false,
  });

  if (run.error) {
    return (
      <LabShell>
        <LabHeader
          path={`evaluations/${runId.slice(-8)}`}
          crumbs={[{ href: "/app/evaluations", label: "evaluations" }]}
          title="Evaluation run"
          icon={<FlaskConicalIcon />}
        />
        <ErrorState error={run.error} onRetry={() => void run.refetch()} />
      </LabShell>
    );
  }
  if (!run.data) {
    return (
      <LabShell>
        <Skeleton className="mb-6 h-36 rounded-2xl" />
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg" />
          ))}
        </div>
      </LabShell>
    );
  }
  return <RunView run={run.data} />;
}

function RunView({ run }: { run: EvaluationRunDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const developerMode = useUiStore((s) => s.developerMode);
  const meta = statusMeta(RUN_STATUS, run.status);
  const m = run.metrics ?? {};
  const pending = run.status === "queued" || run.status === "running";
  const results = run.results ?? [];
  const byCategory = (m.by_category && typeof m.by_category === "object" ? m.by_category : {}) as Record<
    string,
    { cases?: number; passed?: number; task_success_rate?: number | null }
  >;
  const hasStrategy = Object.values(run.strategy_config ?? {}).some((v) =>
    Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : v != null,
  );

  const again = useMutation({
    mutationFn: () =>
      evaluationsApi.start(
        {
          suite: run.suite,
          label: run.strategy_label,
          model_mode: run.model === "scripted" ? "scripted" : "configured",
          repetitions: run.repetitions,
          case_ids: run.case_ids,
          platform: run.tenant_id === null,
          strategy: hasStrategy ? (run.strategy_config as StrategyConfig) : null,
        },
        newIdempotencyKey(),
      ),
    onSuccess: (next) => {
      void queryClient.invalidateQueries({ queryKey: qk.evaluations.list });
      toast.success("New run queued with the same settings");
      router.push(`/app/evaluations/${next.id}`);
    },
    onError: (err) => toastError(err, "Couldn't queue the run"),
  });

  return (
    <LabShell>
      <LabHeader
        path={run.id.slice(-8)}
        crumbs={[{ href: "/app/evaluations", label: "evaluations" }]}
        icon={<FlaskConicalIcon />}
        title={
          <span className="font-mono text-xl sm:text-2xl">
            {run.suite}
            <span className="text-fg-subtle"> / </span>
            {run.strategy_label}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LabStatusBadge meta={meta} size="md" />
            <span className="text-fg-muted">{meta.description}</span>
          </span>
        }
        actions={
          !pending && !run.experiment_id ? (
            <Button variant="secondary" onClick={() => again.mutate()} loading={again.isPending}>
              <RotateCcwIcon /> Run again
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-5">
        {pending && <EvaluationWorkerNotice pending />}
        {run.status === "failed" && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-xl border border-danger/30 bg-danger/[0.06] px-4 py-3"
          >
            <XCircleIcon className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-danger">The run failed before every case was scored</p>
              {run.error && (
                <pre className="mt-1 font-mono text-xs break-words whitespace-pre-wrap text-fg-muted">{run.error}</pre>
              )}
            </div>
          </div>
        )}

        <div aria-live="polite" className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Readout
            label="Success"
            value={pct(m.task_success_rate)}
            sub={
              num(m.cases) !== null
                ? `${num(m.passed) ?? 0} / ${num(m.cases)} cases`
                : pending
                  ? "waiting for results"
                  : undefined
            }
            tone="accent"
          />
          <Readout
            label="Unauthorized"
            value={pct(m.unauthorized_action_rate)}
            sub="must be 0%"
            tone={
              num(m.unauthorized_action_rate) === null
                ? "neutral"
                : num(m.unauthorized_action_rate)! > 0
                  ? "danger"
                  : "success"
            }
          />
          <Readout
            label="False completion"
            value={pct(m.false_completion_rate)}
            sub="claimed done, wasn't"
            tone={
              num(m.false_completion_rate) === null
                ? "neutral"
                : num(m.false_completion_rate)! > 0
                  ? "danger"
                  : "success"
            }
          />
          <Readout label="Verification" value={pct(m.verification_pass_rate)} sub="read-back confirmed" tone="verify" />
          <Readout label="Recovery" value={pct(m.recovery_success_rate)} sub="recovered after faults" tone="neutral" />
          <Readout label="Tool accuracy" value={pct(m.tool_call_accuracy)} sub="expected calls & args" tone="neutral" />
          <Readout label="Completion" value={pct(m.completion_rate)} sub="tasks ended completed" tone="neutral" />
          <Readout
            label="Latency (mean)"
            value={num(m.latency_ms_mean) !== null ? durationMs(num(m.latency_ms_mean)) : "—"}
            sub={num(m.latency_ms_p95) !== null ? `p95 ${durationMs(num(m.latency_ms_p95))}` : undefined}
          />
          <Readout
            label="Cost per task"
            value={num(m.cost_per_task) !== null ? usd(num(m.cost_per_task)) : "—"}
            sub={run.model === "scripted" ? "scripted planner" : run.model}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <LabPanel
            title="Per-case results"
            meta={results.length ? `${results.length} scored` : undefined}
            bodyClassName="p-0"
          >
            {results.length === 0 ? (
              <EmptyState
                size="sm"
                icon={<FlaskConicalIcon />}
                title={pending ? "No results yet" : "No cases were scored"}
                description={
                  pending
                    ? "Results stream in here as each case finishes."
                    : "The run finished without per-case results."
                }
              />
            ) : (
              <ResultsTable results={results} developerMode={developerMode} />
            )}
          </LabPanel>
          <div className="flex flex-col gap-5">
            {Object.keys(byCategory).length > 0 && (
              <LabPanel title="By category">
                <ul className="flex flex-col gap-3">
                  {Object.entries(byCategory).map(([cat, v]) => {
                    const rate = num(v.task_success_rate);
                    return (
                      <li key={cat} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-fg-muted">{humanize(cat)}</span>
                          <span className="font-mono text-fg tabular-nums">
                            {v.passed ?? 0}/{v.cases ?? 0} · {pct(rate)}
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-accent/10" aria-hidden>
                          <div
                            className={cn("h-full rounded-full", rate === 1 ? "bg-success" : "bg-accent")}
                            style={{ width: `${Math.round((rate ?? 0) * 100)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </LabPanel>
            )}
            <LabPanel title="Run">
              <KeyValue
                items={[
                  ["Run", <IdChip key="id" id={run.id} />],
                  [
                    "Model",
                    <span key="m" className="font-mono text-xs">
                      {run.model}
                    </span>,
                  ],
                  ["Cases", run.case_ids?.length ? `${run.case_ids.length} selected` : "Whole suite"],
                  ["Repetitions", `×${run.repetitions}`],
                  ["Queued", dateTime(run.created_at)],
                  ["Started", dateTime(run.started_at)],
                  ["Finished", dateTime(run.completed_at)],
                  ["Duration", run.started_at ? duration(run.started_at, run.completed_at) : "—"],
                  ...(run.experiment_id
                    ? ([
                        [
                          "Experiment",
                          <Link
                            key="e"
                            href={`/app/experiments/${run.experiment_id}`}
                            className="text-accent hover:underline"
                          >
                            Open experiment{run.variant ? ` · ${run.variant}` : ""}
                          </Link>,
                        ],
                      ] as Array<[React.ReactNode, React.ReactNode]>)
                    : []),
                  [
                    "Scope",
                    run.tenant_id === null ? (
                      <Badge key="s" tone="verify">
                        Platform
                      </Badge>
                    ) : (
                      "This organization"
                    ),
                  ],
                ]}
              />
            </LabPanel>
            <LabPanel title="Strategy">
              {hasStrategy ? (
                <JsonViewer value={run.strategy_config} />
              ) : (
                <p className="text-[13px] text-fg-muted">Default strategy (no overrides pinned).</p>
              )}
            </LabPanel>
          </div>
        </div>
      </div>
    </LabShell>
  );
}

function ResultsTable({ results, developerMode }: { results: EvaluationResultOut[]; developerMode: boolean }) {
  const [open, setOpen] = React.useState<string | null>(null);
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-[13px]">
        <caption className="sr-only">Per-case results</caption>
        <thead>
          <tr className="border-b border-line text-2xs tracking-wider text-fg-subtle uppercase">
            <th scope="col" className="w-8 px-3 py-2">
              <span className="sr-only">Expand</span>
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Case
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Result
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Task status
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Safety
            </th>
            <th scope="col" className="px-2 py-2 font-medium">
              Verify
            </th>
            <th scope="col" className="px-2 py-2 text-right font-medium">
              Latency
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Cost
            </th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const expanded = open === r.id;
            const details = r.details ?? {};
            const failures = Array.isArray(details.failures) ? (details.failures as string[]) : [];
            const tools = Array.isArray(details.executed_tools) ? (details.executed_tools as string[]) : [];
            return (
              <React.Fragment key={r.id}>
                <tr
                  className={cn(
                    "cursor-pointer border-b border-line outline-none hover:bg-white/[0.02] focus-visible:bg-white/[0.04]",
                    !r.passed && "bg-danger/[0.03]",
                  )}
                  onClick={() => setOpen(expanded ? null : r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpen(expanded ? null : r.id);
                    }
                  }}
                  tabIndex={0}
                  aria-expanded={expanded}
                >
                  <td className="px-3 py-2.5">
                    <ChevronRightIcon
                      className={cn("size-3.5 text-fg-subtle transition-transform", expanded && "rotate-90")}
                      aria-hidden
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="font-mono text-xs text-fg">{r.case_id}</div>
                    <div className="text-2xs text-fg-subtle">
                      {humanize(r.category)}
                      {r.repetition > 0 ? ` · rep ${r.repetition + 1}` : ""}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <CheckMark ok={r.passed} label={r.passed ? "passed" : "failed"} />
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-fg-muted">{r.task_status ?? "—"}</td>
                  <td className="px-2 py-2.5">
                    {r.unauthorized_action ? (
                      <Badge tone="danger">Unauthorized</Badge>
                    ) : r.false_completion ? (
                      <Badge tone="danger">False completion</Badge>
                    ) : (
                      <CheckMark ok />
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <CheckMark ok={r.verification_passed} />
                  </td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs text-fg-muted tabular-nums">
                    {durationMs(r.latency_ms)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-fg-muted tabular-nums">
                    {usd(r.cost_usd)}
                  </td>
                </tr>
                {expanded && (
                  <tr className="border-b border-line bg-bg/40">
                    <td />
                    <td colSpan={7} className="px-2 pt-2 pb-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Findings</div>
                          {failures.length ? (
                            <ul className="flex flex-col gap-1">
                              {failures.map((f, i) => (
                                <li key={i} className="font-mono text-xs text-danger">
                                  ✗ {f}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="font-mono text-xs text-success">✓ every expectation met</p>
                          )}
                        </div>
                        <div>
                          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Executed tools</div>
                          {tools.length ? (
                            <div className="flex flex-wrap gap-1">
                              {tools.map((t, i) => (
                                <span
                                  key={i}
                                  title={humanizeTool(t)}
                                  className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-fg-muted"
                                >
                                  {t}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-fg-subtle">No tools executed.</p>
                          )}
                          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                            <dt className="text-fg-subtle">Approvals</dt>
                            <dd className="font-mono text-fg-muted">
                              {String(details.approvals_granted ?? 0)}/{String(details.approvals_requested ?? 0)}{" "}
                              granted
                            </dd>
                            <dt className="text-fg-subtle">Recovery attempts</dt>
                            <dd className="font-mono text-fg-muted">{String(details.recovery_attempts ?? 0)}</dd>
                            <dt className="text-fg-subtle">Tool accuracy</dt>
                            <dd className="font-mono text-fg-muted">{pct(r.tool_call_accuracy)}</dd>
                          </dl>
                        </div>
                      </div>
                      {developerMode && <JsonViewer value={details} className="mt-3" />}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
