"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRightIcon,
  DnaIcon,
  GavelIcon,
  PlayIcon,
  RadioTowerIcon,
  RocketIcon,
  SplitIcon,
  TrophyIcon,
  UndoDotIcon,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/controls";
import { IdChip, JsonViewer, KeyValue, RelativeTime } from "@/components/ui/data-display";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import { experimentsApi, type EvaluationRunOut, type ExperimentDetail as ExperimentDetailOut } from "@/lib/api";
import { dateTime, humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import {
  EvaluationWorkerNotice,
  LabHeader,
  LabPanel,
  LabShell,
  LabStatusBadge,
  Readout,
} from "@/components/evaluations/lab";
import {
  EXPERIMENT_STATUS,
  GATE_DECISION,
  num,
  pct,
  RUN_STATUS,
  statusMeta,
} from "@/components/evaluations/lab-status";
import { RateBar } from "@/components/evaluations/evaluations-lab";
import {
  controlName,
  experimentActions,
  experimentStages,
  latestRunsByVariant,
  pendingVariants,
} from "./experiment-state";
import { kindLabel } from "./experiments-lab";
import { GateChecksTable, MetricsComparison } from "./gate-checks";
import { CanaryDialog, RollbackDialog, rolloutErrorMessage } from "./rollout-dialogs";
import { Stepper } from "./stepper";
import { InlineAlert } from "@/components/settings/inline-alert";

export function ExperimentDetail({ experimentId }: { experimentId: string }) {
  const exp = useQuery({
    queryKey: qk.experiments.detail(experimentId),
    queryFn: ({ signal }) => experimentsApi.get(experimentId, { signal }),
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      const busy =
        d.status === "running" || (d.runs ?? []).some((r) => r.status === "queued" || r.status === "running");
      return busy ? 4000 : false;
    },
  });
  if (exp.error) {
    return (
      <LabShell>
        <LabHeader
          path={experimentId.slice(-8)}
          crumbs={[{ href: "/app/experiments", label: "experiments" }]}
          title="Experiment"
          icon={<SplitIcon />}
        />
        <ErrorState error={exp.error} onRetry={() => void exp.refetch()} />
      </LabShell>
    );
  }
  if (!exp.data) {
    return (
      <LabShell>
        <Skeleton className="mb-6 h-40 rounded-2xl" />
        <div className="grid gap-5 lg:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </LabShell>
    );
  }
  return <ExperimentView exp={exp.data} />;
}

type Dialog = "start" | "decide" | "canary" | "promote" | "rollback" | null;

function ExperimentView({ exp }: { exp: ExperimentDetailOut }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<Dialog>(null);
  const meta = statusMeta(EXPERIMENT_STATUS, exp.status);
  const actions = experimentActions(exp);
  const runs = exp.runs ?? [];
  const pending = pendingVariants(exp, runs);
  const latest = latestRunsByVariant(runs);
  const control = controlName(exp);
  const runsBusy = runs.some((r) => r.status === "queued" || r.status === "running");

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.experiments.detail(exp.id) });
    void queryClient.invalidateQueries({ queryKey: qk.experiments.list });
  };

  const mutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "start" }
        | { kind: "decide" }
        | { kind: "rollout"; pct: number }
        | { kind: "rollback"; reason: string },
    ) => {
      switch (action.kind) {
        case "start":
          return experimentsApi.start(exp.id);
        case "decide":
          return experimentsApi.decide(exp.id);
        case "rollout":
          return experimentsApi.rollout(exp.id, { rollout_percentage: action.pct });
        case "rollback":
          return experimentsApi.rollback(exp.id, { reason: action.reason });
      }
    },
    onSuccess: (out, action) => {
      queryClient.setQueryData<ExperimentDetailOut>(qk.experiments.detail(exp.id), (prev) =>
        prev ? { ...prev, ...out } : prev,
      );
      refresh();
      setDialog(null);
      const message =
        action.kind === "start"
          ? "Experiment started — one evaluation run per variant was queued"
          : action.kind === "decide"
            ? out.winner_variant
              ? `Winner: ${out.winner_variant}`
              : "No variant beat the control"
            : action.kind === "rollout"
              ? action.pct >= 100
                ? "Promoted to every task"
                : `Canary live at ${action.pct}%`
              : "Rolled back";
      toast.success(message);
    },
  });

  const open = (d: Dialog) => {
    mutation.reset();
    setDialog(d);
  };
  const variantNames = exp.variants.map((v) => String(v.name ?? ""));
  const safety = exp.safety_checks as Record<
    string,
    {
      decision?: string;
      reason?: string;
      confidence?: number | null;
      gain?: number | null;
      checks?: Record<string, unknown>;
    }
  >;
  const decidedMetrics = exp.metrics as Record<string, Record<string, unknown>>;
  const comparison = variantNames.map((name) => ({
    name,
    metrics: (decidedMetrics?.[name] ?? latest.get(name)?.metrics ?? {}) as Record<string, unknown>,
    tag:
      name === control ? (
        <Badge tone="info">control</Badge>
      ) : name === exp.winner_variant ? (
        <Badge tone="success">winner</Badge>
      ) : undefined,
  }));
  const hasAnyMetrics = comparison.some((c) => Object.keys(c.metrics).length > 0);

  return (
    <LabShell>
      <LabHeader
        path={exp.id.slice(-8)}
        crumbs={[{ href: "/app/experiments", label: "experiments" }]}
        icon={<SplitIcon />}
        title={exp.name}
        description={
          <span className="flex flex-col gap-3">
            <span className="flex flex-wrap items-center gap-2">
              <LabStatusBadge meta={meta} size="md" />
              <span className="text-fg-muted">
                {kindLabel(exp.kind)} · <span className="font-mono">{exp.evaluation_set}</span> · ×{exp.repetitions}
              </span>
              {exp.tenant_id === null && <Badge tone="verify">Platform-wide</Badge>}
            </span>
            <Stepper stages={experimentStages(exp)} label="Experiment lifecycle" />
          </span>
        }
        actions={
          <>
            {actions.start && (
              <Button variant="primary" onClick={() => open("start")}>
                <PlayIcon /> Start
              </Button>
            )}
            {actions.decide && (
              <Tooltip content={pending.length ? `Waiting for runs: ${pending.join(", ")}` : null}>
                <span>
                  <Button
                    variant={exp.status === "running" ? "primary" : "secondary"}
                    onClick={() => open("decide")}
                    disabled={pending.length > 0}
                  >
                    <GavelIcon /> {exp.decided_at ? "Re-decide" : "Decide"}
                  </Button>
                </span>
              </Tooltip>
            )}
            {actions.canary && (
              <Button variant={exp.status === "evaluated" ? "primary" : "secondary"} onClick={() => open("canary")}>
                <RadioTowerIcon /> {exp.status === "canary" ? "Adjust canary" : "Start canary"}
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
        {(exp.status === "running" || runsBusy) && <EvaluationWorkerNotice pending={runsBusy} />}

        {exp.status === "rolled_back" && (
          <div role="status" className="rounded-xl border border-recover/30 bg-recover/[0.06] px-4 py-3 text-[13px]">
            <p className="font-medium text-recover">
              Rolled back {exp.rolled_back_at ? <RelativeTime value={exp.rolled_back_at} /> : null}
            </p>
            {exp.rollback_reason && <p className="mt-0.5 text-fg-muted">“{exp.rollback_reason}”</p>}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex flex-col gap-5">
            {exp.decided_at && (
              <LabPanel title="Decision" meta={`decided ${dateTime(exp.decided_at)}`}>
                <div className="flex flex-col gap-4">
                  <div className="flex items-start gap-3">
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-lg border ${exp.winner_variant ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"}`}
                    >
                      <TrophyIcon className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-fg">
                        {exp.winner_variant ? (
                          <>
                            Winner: <span className="font-mono">{exp.winner_variant}</span>
                          </>
                        ) : (
                          "No winner — the control stays"
                        )}
                      </p>
                      {exp.winner_reason && (
                        <p className="mt-0.5 font-mono text-xs break-words text-fg-muted">{exp.winner_reason}</p>
                      )}
                    </div>
                  </div>
                  {Object.entries(safety).map(([variant, d]) => {
                    const decision = statusMeta(GATE_DECISION, d.decision);
                    return (
                      <div key={variant} className="rounded-lg border border-line bg-bg/40 p-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-fg">
                            {variant} <span className="text-fg-subtle">vs {control}</span>
                          </span>
                          <LabStatusBadge meta={decision} />
                        </div>
                        <div className="mb-3 grid gap-2 sm:grid-cols-2">
                          <Readout
                            label="Success gain"
                            value={
                              num(d.gain) !== null
                                ? `${num(d.gain)! >= 0 ? "+" : ""}${(num(d.gain)! * 100).toFixed(1)} pts`
                                : "—"
                            }
                            tone={num(d.gain) !== null && num(d.gain)! > 0 ? "success" : "neutral"}
                          />
                          <Readout
                            label="Confidence"
                            value={num(d.confidence) !== null ? pct(d.confidence, 1) : "—"}
                            sub="one-sided proportion test"
                            tone="verify"
                          />
                        </div>
                        {d.reason && d.reason !== exp.winner_reason && (
                          <p className="mb-3 font-mono text-xs text-fg-muted">{d.reason}</p>
                        )}
                        <GateChecksTable checks={d.checks ?? {}} />
                      </div>
                    );
                  })}
                </div>
              </LabPanel>
            )}

            <LabPanel title="Metrics" meta={exp.decided_at ? "as decided" : "latest runs"}>
              {hasAnyMetrics ? (
                <MetricsComparison columns={comparison} highlight={exp.winner_variant} />
              ) : (
                <EmptyState
                  size="sm"
                  icon={<SplitIcon />}
                  title="No results yet"
                  description={
                    exp.status === "draft"
                      ? "Start the experiment to evaluate every variant."
                      : "Metrics appear as each variant's run completes."
                  }
                />
              )}
            </LabPanel>

            <LabPanel title="Variants" meta={`${exp.variants.length} · first is the control`} bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {exp.variants.map((v, i) => {
                  const name = String(v.name ?? `variant-${i + 1}`);
                  const run = latest.get(name);
                  const config = (v.config ?? {}) as Record<string, unknown>;
                  const configured = Object.values(config).some((x) =>
                    Array.isArray(x) ? x.length : x && typeof x === "object" ? Object.keys(x).length : x != null,
                  );
                  return (
                    <li key={name} className="flex flex-col gap-3 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-fg">{name}</span>
                        {i === 0 && <Badge tone="info">control</Badge>}
                        {name === exp.winner_variant && <Badge tone="success">winner</Badge>}
                        <span className="font-mono text-2xs text-fg-subtle">weight {String(v.weight ?? 1)}</span>
                        <span className="ml-auto flex items-center gap-3">
                          {run ? (
                            <>
                              <LabStatusBadge meta={statusMeta(RUN_STATUS, run.status)} />
                              <RateBar value={num(run.metrics.task_success_rate)} />
                              <Link
                                href={`/app/evaluations/${run.id}`}
                                className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline"
                              >
                                Run <ArrowUpRightIcon className="size-3" aria-hidden />
                              </Link>
                            </>
                          ) : (
                            <span className="text-xs text-fg-subtle">not run yet</span>
                          )}
                        </span>
                      </div>
                      {configured ? (
                        <JsonViewer value={config} />
                      ) : (
                        <p className="text-xs text-fg-subtle">Current strategy (no overrides).</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </LabPanel>
          </div>

          <div className="flex flex-col gap-5">
            <LabPanel title="Hypothesis">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-fg">
                {exp.hypothesis || <span className="text-fg-subtle">No hypothesis recorded.</span>}
              </p>
            </LabPanel>
            <LabPanel title="Rollout">
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-fg-subtle">Share of tasks on the winner</span>
                  <span className="font-mono text-lg font-semibold text-fg tabular-nums">
                    {exp.rollout_percentage}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-accent/10" aria-hidden>
                  <div
                    className={`h-full rounded-full ${exp.status === "promoted" ? "bg-success" : "bg-accent"}`}
                    style={{ width: `${exp.rollout_percentage}%` }}
                  />
                </div>
                <KeyValue
                  items={[
                    ["Approved", exp.approved_at ? dateTime(exp.approved_at) : "Not yet"],
                    ...(exp.approved_by
                      ? ([["Approved by", <IdChip key="a" id={exp.approved_by} />]] as Array<
                          [React.ReactNode, React.ReactNode]
                        >)
                      : []),
                    ...(exp.strategy_candidate_id
                      ? ([
                          [
                            "Strategy",
                            <Link
                              key="c"
                              href={`/app/acbe/candidates/${exp.strategy_candidate_id}`}
                              className="inline-flex items-center gap-1 text-accent hover:underline"
                            >
                              <DnaIcon className="size-3.5" aria-hidden /> ACBE candidate
                            </Link>,
                          ],
                        ] as Array<[React.ReactNode, React.ReactNode]>)
                      : []),
                  ]}
                />
                <p className="text-xs leading-relaxed text-fg-subtle">
                  Rolling out registers the winner as a strategy candidate, which follows the same canary → promote →
                  rollback path (and safety validation) as ACBE-learned strategies.
                </p>
              </div>
            </LabPanel>
            <LabPanel title="Runs" meta={`${runs.length}`} bodyClassName="p-0">
              {runs.length === 0 ? (
                <p className="p-4 text-[13px] text-fg-subtle">
                  {exp.status === "draft" ? "Runs are queued when you start the experiment." : "No runs recorded."}
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {[...runs].reverse().map((r: EvaluationRunOut) => (
                    <li key={r.id}>
                      <Link
                        href={`/app/evaluations/${r.id}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02]"
                      >
                        <span className="w-24 truncate font-mono text-xs text-fg">{r.variant ?? "—"}</span>
                        <LabStatusBadge meta={statusMeta(RUN_STATUS, r.status)} />
                        <span className="ml-auto text-2xs text-fg-subtle">
                          <RelativeTime value={r.created_at} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </LabPanel>
            <LabPanel title="Record">
              <KeyValue
                items={[
                  ["Experiment", <IdChip key="id" id={exp.id} />],
                  ["Kind", humanize(exp.kind)],
                  ["Created", dateTime(exp.created_at)],
                  ["Updated", dateTime(exp.updated_at)],
                  ...(exp.created_by
                    ? ([["Created by", <IdChip key="cb" id={exp.created_by} />]] as Array<
                        [React.ReactNode, React.ReactNode]
                      >)
                    : []),
                ]}
              />
            </LabPanel>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={dialog === "start"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Start this experiment?"
        description={`Queues ${exp.variants.length} evaluation runs — one per variant — on the ${exp.evaluation_set} set. They run on the dedicated evaluation worker; the variants can no longer be edited.`}
        confirmLabel="Start experiment"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ kind: "start" })}
      >
        {mutation.error ? <InlineAlert message={rolloutErrorMessage(mutation.error)} error={mutation.error} /> : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={dialog === "decide"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Decide the winner?"
        description="Compares every challenger with the control using the statistical test and safety gates (unauthorized actions, false completions, regressions, cost). Nothing is rolled out by deciding."
        confirmLabel="Run decision"
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ kind: "decide" })}
      >
        {mutation.error ? <InlineAlert message={rolloutErrorMessage(mutation.error)} error={mutation.error} /> : null}
      </ConfirmDialog>
      <CanaryDialog
        open={dialog === "canary"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={exp.status === "canary" ? "Adjust the canary" : `Start a canary for ${exp.winner_variant}`}
        subject={
          <>
            The winning variant <span className="font-mono text-fg">{exp.winner_variant}</span> becomes a strategy
            candidate.
          </>
        }
        current={exp.rollout_percentage}
        loading={mutation.isPending}
        error={dialog === "canary" ? mutation.error : null}
        onSubmit={(p) => mutation.mutate({ kind: "rollout", pct: p })}
      />
      <ConfirmDialog
        open={dialog === "promote"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Promote ${exp.winner_variant} to every task?`}
        description="The winner becomes the default strategy for every task in scope. The server refuses if the canary period hasn't finished or the canary raised the failure rate. You can still roll back afterwards."
        confirmLabel="Promote to 100%"
        confirmText={exp.winner_variant ?? undefined}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate({ kind: "rollout", pct: 100 })}
      >
        {mutation.error ? <InlineAlert message={rolloutErrorMessage(mutation.error)} error={mutation.error} /> : null}
      </ConfirmDialog>
      <RollbackDialog
        open={dialog === "rollback"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Roll back this experiment?"
        description={
          exp.status === "evaluated"
            ? "Closes the experiment without rolling the winner out."
            : "Immediately takes the winning strategy out of service; affected tasks return to the previous strategy."
        }
        loading={mutation.isPending}
        error={dialog === "rollback" ? mutation.error : null}
        onSubmit={(reason) => mutation.mutate({ kind: "rollback", reason })}
      />
    </LabShell>
  );
}
