"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DnaIcon, FlaskConicalIcon, RadioTowerIcon, RocketIcon, UndoDotIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { CopyButton, IdChip, JsonViewer, KeyValue, RelativeTime } from "@/components/ui/data-display";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { acbeApi, type AcbeExperimentOut, type CandidateDetail as CandidateDetailOut } from "@/lib/api";
import { dateTime, humanize, humanizeTool } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import {
  EvaluationWorkerNotice,
  LabHeader,
  LabPanel,
  LabShell,
  LabStatusBadge,
  Readout,
} from "@/components/evaluations/lab";
import {
  CANDIDATE_STATUS,
  GATE_DECISION,
  num,
  pct,
  statusMeta,
  STRATEGY_EXPERIMENT_STATUS,
} from "@/components/evaluations/lab-status";
import { GateChecksTable, MetricsComparison } from "@/components/experiments/gate-checks";
import { CanaryDialog, RollbackDialog, rolloutErrorMessage } from "@/components/experiments/rollout-dialogs";
import { diffStrategy, formatValue, mergeStrategy, type StrategyLike } from "./config-diff";
import { CandidatePipelineView } from "./pipeline";
import { candidateActions, candidatePipeline } from "./pipeline-state";
import { InlineAlert } from "@/components/settings/inline-alert";

export function CandidateDetail({ candidateId }: { candidateId: string }) {
  const [evaluationRequestedAt, setEvaluationRequestedAt] = React.useState<number | null>(null);
  const candidate = useQuery({
    queryKey: qk.acbe.candidate(candidateId),
    queryFn: ({ signal }) => acbeApi.candidate(candidateId, { signal }),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.status === "evaluating" || (d.experiments ?? []).some((e) => e.status === "running")) return 4000;
      return evaluationRequestedAt && d.status === "draft" ? 5000 : false;
    },
  });
  const failures = useQuery({
    queryKey: qk.acbe.failures,
    queryFn: ({ signal }) => acbeApi.failures({ signal }),
    staleTime: 60_000,
  });

  if (candidate.error) {
    return (
      <LabShell>
        <LabHeader
          path={candidateId.slice(-8)}
          crumbs={[{ href: "/app/acbe", label: "acbe" }]}
          title="Strategy candidate"
          icon={<DnaIcon />}
        />
        <ErrorState error={candidate.error} onRetry={() => void candidate.refetch()} />
      </LabShell>
    );
  }
  if (!candidate.data) {
    return (
      <LabShell>
        <Skeleton className="mb-6 h-48 rounded-2xl" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </LabShell>
    );
  }
  const pattern = failures.data?.find((f) => f.fingerprint === candidate.data.failure_fingerprint) ?? null;
  return (
    <CandidateView
      c={candidate.data}
      pattern={pattern}
      evaluationQueued={evaluationRequestedAt !== null && candidate.data.status === "draft"}
      onEvaluationRequested={() => setEvaluationRequestedAt(Date.now())}
    />
  );
}

type DialogKind = "evaluate" | "canary" | "promote" | "rollback" | null;

function CandidateView({
  c,
  pattern,
  evaluationQueued,
  onEvaluationRequested,
}: {
  c: CandidateDetailOut;
  pattern: {
    occurrences: number;
    tasks: number;
    error_class: string;
    error_code: string;
    sample_message: string;
    first_seen: string;
    last_seen: string;
    tool_name: string | null;
  } | null;
  evaluationQueued: boolean;
  onEvaluationRequested: () => void;
}) {
  const queryClient = useQueryClient();
  const developerMode = useUiStore((s) => s.developerMode);
  const [dialog, setDialog] = React.useState<DialogKind>(null);
  const pipeline = candidatePipeline(c);
  const actions = candidateActions(c.status);
  const meta = statusMeta(CANDIDATE_STATUS, c.status);
  const failed = (c.failed_strategy ?? {}) as { version?: string; config?: StrategyLike };
  const before = (failed.config ?? {}) as StrategyLike;
  const after = mergeStrategy(before, c.candidate_config as StrategyLike);
  const diff = diffStrategy(before, after);
  const experiments = c.experiments ?? [];
  const fromExperiment = c.failure_type === "experiment";
  // A candidate registered from an experiment carries the experiment id (hex) as its fingerprint.
  const experimentId =
    fromExperiment && /^[0-9a-f]{32}$/.test(c.failure_fingerprint)
      ? c.failure_fingerprint.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5")
      : null;

  const mutation = useMutation({
    mutationFn: async (
      a:
        | { kind: "evaluate" }
        | { kind: "canary"; pct: number }
        | { kind: "promote" }
        | { kind: "rollback"; reason: string },
    ) => {
      switch (a.kind) {
        case "evaluate":
          return acbeApi.evaluate(c.id);
        case "canary":
          return acbeApi.canary(c.id, { rollout_percentage: a.pct });
        case "promote":
          return acbeApi.promote(c.id);
        case "rollback":
          return acbeApi.rollback(c.id, { reason: a.reason });
      }
    },
    onSuccess: (out, a) => {
      queryClient.setQueryData<CandidateDetailOut>(qk.acbe.candidate(c.id), (prev) =>
        prev ? { ...prev, ...out } : prev,
      );
      void queryClient.invalidateQueries({ queryKey: qk.acbe.all });
      setDialog(null);
      if (a.kind === "evaluate") onEvaluationRequested();
      toast.success(
        a.kind === "evaluate"
          ? "Evaluation queued"
          : a.kind === "canary"
            ? `Canary live at ${a.pct}%`
            : a.kind === "promote"
              ? `${c.version_label} promoted`
              : `${c.version_label} rolled back`,
        a.kind === "evaluate"
          ? { description: "It runs on the dedicated evaluation worker; this page updates when it starts." }
          : undefined,
      );
    },
  });
  const open = (d: DialogKind) => {
    mutation.reset();
    setDialog(d);
  };

  return (
    <LabShell>
      <LabHeader
        path={c.version_label}
        crumbs={[{ href: "/app/acbe", label: "acbe" }]}
        icon={<DnaIcon />}
        title={<span className="font-mono text-xl sm:text-2xl">{c.version_label}</span>}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <LabStatusBadge meta={meta} size="md" />
            <span className="text-fg-muted">
              Addresses <span className="text-fg">{humanize(c.failure_type)}</span> · scope{" "}
              <span className="font-mono">{c.scope}</span>
            </span>
            {c.tenant_id === null && <Badge tone="verify">Platform-wide</Badge>}
          </span>
        }
        actions={
          <>
            {actions.evaluate && (
              <Button
                variant={c.status === "draft" ? "primary" : "secondary"}
                onClick={() => open("evaluate")}
                disabled={evaluationQueued}
              >
                <FlaskConicalIcon />{" "}
                {evaluationQueued
                  ? "Evaluation queued"
                  : c.status === "evaluating"
                    ? "Re-queue evaluation"
                    : "Evaluate"}
              </Button>
            )}
            {actions.canary && (
              <Button variant={c.status === "passed" ? "primary" : "secondary"} onClick={() => open("canary")}>
                <RadioTowerIcon /> {c.status === "canary" ? "Adjust canary" : "Approve canary"}
              </Button>
            )}
            {actions.promote && (
              <Button variant="primary" onClick={() => open("promote")}>
                <RocketIcon /> Promote
              </Button>
            )}
            {actions.rollback && (
              <Button variant="danger-outline" onClick={() => open("rollback")}>
                <UndoDotIcon /> Roll back
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <LabPanel title="Pipeline" meta={pipeline.needsHuman ? "waiting for a person" : undefined}>
          <div className="flex flex-col gap-4">
            <CandidatePipelineView pipeline={pipeline} />
            <p
              className={cn(
                "rounded-lg border px-3 py-2 text-[13px]",
                pipeline.needsHuman
                  ? "border-warning/30 bg-warning/[0.06] text-fg"
                  : "border-line bg-bg/40 text-fg-muted",
              )}
              aria-live="polite"
            >
              {pipeline.summary}
              {fromExperiment && " This candidate came from a winning experiment, so it skipped failure analysis."}
            </p>
          </div>
        </LabPanel>

        {(c.status === "evaluating" || evaluationQueued) && <EvaluationWorkerNotice pending />}

        {c.status === "rolled_back" && (
          <div role="status" className="rounded-xl border border-recover/30 bg-recover/[0.06] px-4 py-3 text-[13px]">
            <p className="font-medium text-recover">
              Rolled back {c.rolled_back_at ? <RelativeTime value={c.rolled_back_at} /> : null}
            </p>
            {c.rollback_reason && <p className="mt-0.5 text-fg-muted">“{c.rollback_reason}”</p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex flex-col gap-5">
            <LabPanel title="Strategy change" meta={`vs ${failed.version ?? "baseline"}`}>
              <div className="flex flex-col gap-4">
                <p className="text-[13px] leading-relaxed text-fg">
                  {c.rationale || <span className="text-fg-subtle">No rationale recorded.</span>}
                </p>
                {diff.length === 0 ? (
                  <p className="text-xs text-fg-subtle">
                    The patch doesn&apos;t change the strategy that was active when the failures happened.
                  </p>
                ) : (
                  <div className="relative overflow-x-auto rounded-lg border border-line">
                    <table className="w-full min-w-[520px] text-left text-xs">
                      <caption className="sr-only">Configuration changes</caption>
                      <thead>
                        <tr className="border-b border-line bg-surface-2/50 text-2xs tracking-wider text-fg-subtle uppercase">
                          <th scope="col" className="px-3 py-2 font-medium">
                            Setting
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Current ({failed.version ?? "baseline"})
                          </th>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Candidate
                          </th>
                        </tr>
                      </thead>
                      <tbody className="font-mono">
                        {diff.map((row) => {
                          const [group, ...rest] = row.path;
                          return (
                            <tr key={row.path.join("/")} className="border-b border-line last:border-0">
                              <th scope="row" className="px-3 py-2 font-normal">
                                <span className="text-fg-subtle">{humanize(group)}</span>
                                {rest.length > 0 && (
                                  <span className="block text-fg" title={rest[0] ? humanizeTool(rest[0]) : undefined}>
                                    {rest.join(" › ")}
                                  </span>
                                )}
                              </th>
                              <td
                                className={cn(
                                  "px-3 py-2 align-top",
                                  row.kind !== "added"
                                    ? "text-danger/90 line-through decoration-danger/40"
                                    : "text-fg-subtle",
                                )}
                              >
                                {row.kind === "added" ? (
                                  <span className="no-underline">default</span>
                                ) : (
                                  formatValue(row.before)
                                )}
                              </td>
                              <td
                                className={cn(
                                  "px-3 py-2 align-top",
                                  row.kind === "removed" ? "text-fg-subtle" : "text-success",
                                )}
                              >
                                <span aria-hidden>{row.kind === "removed" ? "− " : "+ "}</span>
                                {row.kind === "removed" ? "default" : formatValue(row.after)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <details className="group">
                  <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">
                    Raw patch & full configs
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Candidate patch</div>
                      <JsonViewer value={c.candidate_config} />
                    </div>
                    <div>
                      <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">
                        Strategy when it failed
                      </div>
                      <JsonViewer value={before} />
                    </div>
                  </div>
                </details>
              </div>
            </LabPanel>

            <LabPanel
              title="Evaluation results"
              meta={
                experiments.length
                  ? `${experiments.length} experiment${experiments.length === 1 ? "" : "s"}`
                  : undefined
              }
            >
              {experiments.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<FlaskConicalIcon />}
                  title={
                    evaluationQueued
                      ? "Evaluation queued"
                      : fromExperiment
                        ? "Evaluated as part of an experiment"
                        : "Not evaluated yet"
                  }
                  description={
                    evaluationQueued
                      ? "The baseline-vs-candidate experiment starts when the evaluation worker picks it up."
                      : fromExperiment
                        ? "Its evidence is the experiment that produced it."
                        : "Evaluate it to compare the candidate with the current strategy on targeted and regression cases."
                  }
                />
              ) : (
                <div className="flex flex-col gap-4">
                  {experiments.map((e) => (
                    <StrategyExperimentView key={e.id} e={e} developerMode={developerMode} />
                  ))}
                </div>
              )}
            </LabPanel>
          </div>

          <div className="flex flex-col gap-5">
            <LabPanel title="Evidence">
              <div className="flex flex-col gap-4">
                <KeyValue
                  items={[
                    ["Failure type", humanize(c.failure_type)],
                    [
                      "Fingerprint",
                      <span key="f" className="inline-flex items-center gap-1 font-mono text-xs">
                        {c.failure_fingerprint.slice(0, 16)}
                        <CopyButton value={c.failure_fingerprint} label="Copy fingerprint" />
                      </span>,
                    ],
                    ["Source failures", `${c.source_failure_ids.length} verified`],
                    [
                      "Proposed by",
                      <span key="p" className="font-mono text-xs">
                        {c.created_by}
                      </span>,
                    ],
                    ...(experimentId
                      ? ([
                          [
                            "Experiment",
                            <Link
                              key="x"
                              href={`/app/experiments/${experimentId}`}
                              className="text-accent hover:underline"
                            >
                              Open the experiment
                            </Link>,
                          ],
                        ] as Array<[React.ReactNode, React.ReactNode]>)
                      : []),
                    ["Proposed", dateTime(c.created_at)],
                  ]}
                />
                {pattern ? (
                  <div className="rounded-lg border border-line bg-bg/40 p-3">
                    <div className="mb-2 grid grid-cols-2 gap-2">
                      <Readout label="Occurrences" value={pattern.occurrences} tone="danger" />
                      <Readout label="Tasks" value={pattern.tasks} tone="neutral" />
                    </div>
                    <p className="font-mono text-2xs text-fg-subtle">
                      {pattern.error_class} · {pattern.error_code}
                      {pattern.tool_name ? ` · ${pattern.tool_name}` : ""}
                    </p>
                    <p className="mt-1 text-xs break-words text-fg-muted">“{pattern.sample_message}”</p>
                    <p className="mt-1 text-2xs text-fg-subtle">
                      First seen <RelativeTime value={pattern.first_seen} /> · last seen{" "}
                      <RelativeTime value={pattern.last_seen} />
                    </p>
                  </div>
                ) : !fromExperiment ? (
                  <p className="text-xs text-fg-subtle">
                    The failure pattern is no longer in this organization&apos;s recent failure analysis.
                  </p>
                ) : null}
                {developerMode && c.source_failure_ids.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {c.source_failure_ids.slice(0, 12).map((id) => (
                      <IdChip key={id} id={id} />
                    ))}
                    {c.source_failure_ids.length > 12 && (
                      <span className="text-2xs text-fg-subtle">+{c.source_failure_ids.length - 12} more</span>
                    )}
                  </div>
                )}
              </div>
            </LabPanel>

            <LabPanel title="Rollout">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-fg-subtle">Share of tasks using it</span>
                  <span className="font-mono text-lg font-semibold text-fg tabular-nums">{c.rollout_percentage}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-accent/10" aria-hidden>
                  <div
                    className={cn("h-full rounded-full", c.status === "promoted" ? "bg-success" : "bg-accent")}
                    style={{ width: `${c.rollout_percentage}%` }}
                  />
                </div>
                <KeyValue
                  items={[
                    ["Canary approved", c.approved_at ? dateTime(c.approved_at) : "Not yet"],
                    ...(c.approved_by
                      ? ([["Approved by", <IdChip key="a" id={c.approved_by} />]] as Array<
                          [React.ReactNode, React.ReactNode]
                        >)
                      : []),
                    ["Promoted", c.promoted_at ? dateTime(c.promoted_at) : "Not yet"],
                    ...(c.rolled_back_at
                      ? ([["Rolled back", dateTime(c.rolled_back_at)]] as Array<[React.ReactNode, React.ReactNode]>)
                      : []),
                  ]}
                />
                <p className="text-xs leading-relaxed text-fg-subtle">
                  Promotion is allowed only after the canary observation period, and only if the canary didn&apos;t
                  raise the failure rate for this pattern. Rollback works at any time and takes effect immediately.
                </p>
              </div>
            </LabPanel>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "evaluate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Evaluate ${c.version_label}?`}
        description="Queues a controlled experiment — the current strategy vs this candidate — on cases targeting this failure type plus the regression suite, then applies the promotion gate. It runs on the dedicated evaluation worker and never affects real tasks."
        confirmLabel="Queue evaluation"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ kind: "evaluate" })}
      >
        {mutation.error ? <InlineAlert message={rolloutErrorMessage(mutation.error)} error={mutation.error} /> : null}
      </ConfirmDialog>
      <CanaryDialog
        open={dialog === "canary"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={c.status === "canary" ? "Adjust the canary" : `Approve a canary for ${c.version_label}`}
        subject={
          <>
            You are approving a real-traffic trial of <span className="font-mono text-fg">{c.version_label}</span>.
          </>
        }
        current={c.rollout_percentage}
        loading={mutation.isPending}
        error={dialog === "canary" ? mutation.error : null}
        onSubmit={(p) => mutation.mutate({ kind: "canary", pct: p })}
      />
      <ConfirmDialog
        open={dialog === "promote"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Promote ${c.version_label}?`}
        description={`Every task in scope${c.tenant_id === null ? " — across all organizations —" : ""} will use this strategy. The server checks the canary period and the canary's failure rate first. You can roll back afterwards.`}
        confirmLabel="Promote to 100%"
        confirmText={c.version_label}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ kind: "promote" })}
      >
        {mutation.error ? <InlineAlert message={rolloutErrorMessage(mutation.error)} error={mutation.error} /> : null}
      </ConfirmDialog>
      <RollbackDialog
        open={dialog === "rollback"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Roll back ${c.version_label}?`}
        description={
          c.status === "passed"
            ? "Withdraws the candidate before any rollout. It can't be canaried afterwards."
            : "Takes the strategy out of service immediately. Tasks go back to the previous strategy."
        }
        loading={mutation.isPending}
        error={dialog === "rollback" ? mutation.error : null}
        onSubmit={(reason) => mutation.mutate({ kind: "rollback", reason })}
      />
    </LabShell>
  );
}

function StrategyExperimentView({ e, developerMode }: { e: AcbeExperimentOut; developerMode: boolean }) {
  const decision = e.decision ? statusMeta(GATE_DECISION, e.decision) : null;
  const safety = (e.safety_checks ?? {}) as Record<string, unknown>;
  const { policy, gain, ...checks } = safety;
  const regression = (e.regression_metrics ?? {}) as Record<string, Record<string, unknown>>;
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-fg">experiment v{e.experiment_version}</span>
        <LabStatusBadge meta={statusMeta(STRATEGY_EXPERIMENT_STATUS, e.status)} />
        {decision && <LabStatusBadge meta={decision} />}
        <span className="ml-auto font-mono text-2xs text-fg-subtle">{e.evaluation_suite}</span>
      </div>
      {e.decision_reason && <p className="mb-3 font-mono text-xs break-words text-fg-muted">{e.decision_reason}</p>}
      <div className="mb-3 grid gap-2 sm:grid-cols-3">
        <Readout
          label="Success gain"
          value={num(gain) !== null ? `${num(gain)! >= 0 ? "+" : ""}${(num(gain)! * 100).toFixed(1)} pts` : "—"}
          tone={num(gain) !== null && num(gain)! > 0 ? "success" : "neutral"}
        />
        <Readout label="Confidence" value={num(e.confidence) !== null ? pct(e.confidence, 1) : "—"} tone="verify" />
        <Readout
          label="Duration"
          value={e.completed_at ? <RelativeTime value={e.completed_at} /> : "running"}
          sub={`started ${dateTime(e.started_at)}`}
        />
      </div>
      {(Object.keys(e.baseline_metrics ?? {}).length > 0 || Object.keys(e.candidate_metrics ?? {}).length > 0) && (
        <div className="mb-3">
          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Targeted cases</div>
          <MetricsComparison
            columns={[
              { name: "baseline", metrics: e.baseline_metrics as Record<string, unknown> },
              { name: "candidate", metrics: e.candidate_metrics as Record<string, unknown> },
            ]}
            highlight="candidate"
          />
        </div>
      )}
      {regression.baseline && regression.candidate && (
        <div className="mb-3">
          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Regression suite</div>
          <MetricsComparison
            columns={[
              { name: "baseline", metrics: regression.baseline },
              { name: "candidate", metrics: regression.candidate },
            ]}
            highlight="candidate"
          />
        </div>
      )}
      <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Safety gates</div>
      <GateChecksTable checks={checks} />
      {developerMode && policy ? (
        <div className="mt-3">
          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">Promotion policy</div>
          <JsonViewer value={policy} />
        </div>
      ) : null}
    </div>
  );
}
