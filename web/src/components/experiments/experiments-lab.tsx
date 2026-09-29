"use client";

import { useQuery } from "@tanstack/react-query";
import { PlusIcon, SplitIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { evaluationsApi, experimentsApi, normalizeError, type EvaluationExperimentOut } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { LabHeader, LabShell, LabStatusBadge } from "@/components/evaluations/lab";
import { EXPERIMENT_STATUS, statusMeta } from "@/components/evaluations/lab-status";
import { CreateExperimentDialog, EXPERIMENT_KINDS } from "./create-experiment-dialog";

export function kindLabel(kind: string): string {
  return EXPERIMENT_KINDS.find((k) => k.value === kind)?.label ?? kind.replace(/_/g, " ");
}

export function ExperimentsLab() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const suites = useQuery({
    queryKey: qk.evaluations.suites,
    queryFn: ({ signal }) => evaluationsApi.suites({ signal }),
    staleTime: 10 * 60_000,
  });
  const [live, setLive] = React.useState(false);
  const list = useCursorQuery<EvaluationExperimentOut>({
    queryKey: qk.experiments.list,
    fetchPage: (cursor, signal) => experimentsApi.list({ cursor, limit: 50 }, { signal }),
    refetchInterval: live ? 5000 : 30_000,
  });
  const anyRunning = list.items.some((e) => e.status === "running");
  if (anyRunning !== live) setLive(anyRunning);
  const forbidden = list.error && normalizeError(list.error).kind === "forbidden";

  const columns: Column<EvaluationExperimentOut>[] = [
    {
      id: "status",
      header: "Status",
      className: "w-36",
      cell: (e) => <LabStatusBadge meta={statusMeta(EXPERIMENT_STATUS, e.status)} />,
    },
    {
      id: "name",
      header: "Experiment",
      cell: (e) => (
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{e.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-fg-subtle">
            <span>{kindLabel(e.kind)}</span>
            <span className="font-mono">· {e.evaluation_set}</span>
            <span>· {e.variants.length} variants</span>
            {e.tenant_id === null && <Badge tone="verify">platform</Badge>}
          </div>
        </div>
      ),
    },
    {
      id: "winner",
      header: "Winner",
      hideBelow: "md",
      cell: (e) =>
        e.winner_variant ? (
          <span className="font-mono text-xs text-success">{e.winner_variant}</span>
        ) : e.decided_at ? (
          <span className="text-xs text-fg-subtle">none</span>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        ),
    },
    {
      id: "rollout",
      header: "Rollout",
      hideBelow: "sm",
      cell: (e) => (
        <span className="font-mono text-xs text-fg-muted tabular-nums">
          {e.rollout_percentage ? `${e.rollout_percentage}%` : "—"}
        </span>
      ),
    },
    {
      id: "created",
      header: "Created",
      hideBelow: "lg",
      cell: (e) => <RelativeTime value={e.created_at} className="text-xs text-fg-muted" />,
    },
  ];

  return (
    <LabShell>
      <LabHeader
        path="experiments"
        icon={<SplitIcon />}
        title="Experiments"
        description="Controlled A/B comparisons of strategy variants on an evaluation set. Winners are chosen by a deterministic statistical test with safety gates; rollouts are canaried and always need a human decision."
        actions={
          !forbidden && (
            <Button variant="primary" onClick={() => setOpen(true)} disabled={!suites.data?.length}>
              <PlusIcon /> New experiment
            </Button>
          )
        }
      />
      {forbidden ? (
        <ErrorState error={list.error} />
      ) : (
        <DataTable
          caption="Experiments"
          columns={columns}
          rows={list.items}
          rowKey={(e) => e.id}
          isLoading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          onRowClick={(e) => router.push(`/app/experiments/${e.id}`)}
          hasMore={list.hasNextPage}
          onLoadMore={() => void list.fetchNextPage()}
          isLoadingMore={list.isFetchingNextPage}
          empty={
            <EmptyState
              icon={<SplitIcon />}
              title="No experiments yet"
              description="Define a control and one or more challengers — for example longer verification read-back — and let the evaluation harness measure the difference."
              action={
                <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!suites.data?.length}>
                  <PlusIcon /> Create an experiment
                </Button>
              }
            />
          }
        />
      )}
      {suites.data && <CreateExperimentDialog open={open} onOpenChange={setOpen} suites={suites.data} />}
    </LabShell>
  );
}
