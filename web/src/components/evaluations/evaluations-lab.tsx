"use client";

import { useQuery } from "@tanstack/react-query";
import { FlaskConicalIcon, ListTreeIcon, PlayIcon, PlaySquareIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { evaluationsApi, normalizeError, type EvaluationRunOut, type SuiteOut } from "@/lib/api";
import { duration, humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { cn } from "@/lib/utils";
import { EvaluationWorkerNotice, LabHeader, LabPanel, LabShell, LabStatusBadge } from "./lab";
import { num, pct, RUN_STATUS, statusMeta } from "./lab-status";
import { StartRunDialog } from "./start-run-dialog";

export function RateBar({ value, tone = "accent" }: { value: number | null; tone?: "accent" | "success" | "danger" }) {
  if (value === null) return <span className="font-mono text-xs text-fg-subtle">—</span>;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
        <span
          className={cn(
            "block h-full rounded-full",
            tone === "success" ? "bg-success" : tone === "danger" ? "bg-danger" : "bg-accent",
          )}
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </span>
      <span className="font-mono text-xs text-fg tabular-nums">{pct(value)}</span>
    </span>
  );
}

export function EvaluationsLab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "suites" ? "suites" : "runs";
  const [open, setOpen] = React.useState(false);

  const suites = useQuery({
    queryKey: qk.evaluations.suites,
    queryFn: ({ signal }) => evaluationsApi.suites({ signal }),
    staleTime: 10 * 60_000,
  });
  const [pollFast, setPollFast] = React.useState(false);
  const runs = useCursorQuery<EvaluationRunOut>({
    queryKey: qk.evaluations.list,
    fetchPage: (cursor, signal) => evaluationsApi.list({ cursor, limit: 50 }, { signal }),
    refetchInterval: pollFast ? 4000 : 30_000,
  });
  const pending = runs.items.some((r) => r.status === "queued" || r.status === "running");
  if (pending !== pollFast) setPollFast(pending);

  const forbidden =
    (runs.error && normalizeError(runs.error).kind === "forbidden") ||
    (suites.error && normalizeError(suites.error).kind === "forbidden");

  const columns: Column<EvaluationRunOut>[] = [
    {
      id: "status",
      header: "Status",
      className: "w-36",
      cell: (r) => <LabStatusBadge meta={statusMeta(RUN_STATUS, r.status)} />,
    },
    {
      id: "run",
      header: "Run",
      cell: (r) => (
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[12.5px] text-fg">
            <span className="text-fg-muted">{r.suite}</span>
            <span className="text-fg-subtle">/</span>
            <span className="truncate">{r.strategy_label}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-fg-subtle">
            <span className="font-mono">{r.model}</span>
            <span>· {r.case_ids?.length ? `${r.case_ids.length} cases` : "all cases"}</span>
            <span>· ×{r.repetitions}</span>
            {r.variant && <span>· variant {r.variant}</span>}
            {r.tenant_id === null && <Badge tone="verify">platform</Badge>}
          </div>
        </div>
      ),
    },
    { id: "success", header: "Success", cell: (r) => <RateBar value={num(r.metrics.task_success_rate)} /> },
    {
      id: "unauth",
      header: "Unauthorized",
      hideBelow: "md",
      cell: (r) => {
        const v = num(r.metrics.unauthorized_action_rate);
        return v === null ? (
          <span className="font-mono text-xs text-fg-subtle">—</span>
        ) : (
          <span className={cn("font-mono text-xs tabular-nums", v > 0 ? "text-danger" : "text-success")}>{pct(v)}</span>
        );
      },
    },
    {
      id: "false",
      header: "False done",
      hideBelow: "lg",
      cell: (r) => {
        const v = num(r.metrics.false_completion_rate);
        return v === null ? (
          <span className="font-mono text-xs text-fg-subtle">—</span>
        ) : (
          <span className={cn("font-mono text-xs tabular-nums", v > 0 ? "text-danger" : "text-fg-muted")}>
            {pct(v)}
          </span>
        );
      },
    },
    {
      id: "created",
      header: "Queued",
      hideBelow: "sm",
      cell: (r) => <RelativeTime value={r.created_at} className="text-xs text-fg-muted" />,
    },
    {
      id: "duration",
      header: "Duration",
      hideBelow: "lg",
      cell: (r) => (
        <span className="font-mono text-xs text-fg-muted">
          {r.started_at ? duration(r.started_at, r.completed_at) : "—"}
        </span>
      ),
    },
  ];

  return (
    <LabShell>
      <LabHeader
        path="evaluations"
        icon={<FlaskConicalIcon />}
        title="Evaluations"
        description="Benchmark the agent against suites of realistic cases in simulated Google Workspace environments. Every run scores success, unauthorized actions, false completions, verification, recovery, latency and cost."
        actions={
          !forbidden && (
            <Button variant="primary" onClick={() => setOpen(true)} disabled={!suites.data?.length}>
              <PlayIcon /> New run
            </Button>
          )
        }
      />
      {forbidden ? (
        <ErrorState error={runs.error ?? suites.error} />
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => {
            const next = new URLSearchParams(params.toString());
            if (v === "suites") next.set("tab", "suites");
            else next.delete("tab");
            const qs = next.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
          }}
        >
          <TabsList>
            <TabsTrigger value="runs">
              <PlaySquareIcon /> Runs
            </TabsTrigger>
            <TabsTrigger value="suites">
              <ListTreeIcon /> Suites{" "}
              {suites.data ? <span className="font-mono text-2xs text-fg-subtle">{suites.data.length}</span> : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="runs" className="flex flex-col gap-4">
            <EvaluationWorkerNotice pending={pending} />
            <DataTable
              caption="Evaluation runs"
              columns={columns}
              rows={runs.items}
              rowKey={(r) => r.id}
              isLoading={runs.isLoading}
              error={runs.error}
              onRetry={() => void runs.refetch()}
              onRowClick={(r) => router.push(`/app/evaluations/${r.id}`)}
              hasMore={runs.hasNextPage}
              onLoadMore={() => void runs.fetchNextPage()}
              isLoadingMore={runs.isFetchingNextPage}
              empty={
                <EmptyState
                  icon={<FlaskConicalIcon />}
                  title="No evaluation runs yet"
                  description="Start with the core suite on the scripted planner — it is deterministic, so it makes a good baseline to compare changes against."
                  action={
                    <Button variant="primary" size="sm" onClick={() => setOpen(true)} disabled={!suites.data?.length}>
                      <PlayIcon /> Run the core suite
                    </Button>
                  }
                />
              }
            />
          </TabsContent>
          <TabsContent value="suites">
            {suites.error ? (
              <ErrorState error={suites.error} onRetry={() => void suites.refetch()} />
            ) : !suites.data ? (
              <Skeleton className="h-72 rounded-xl" />
            ) : (
              <SuitesView suites={suites.data} />
            )}
          </TabsContent>
        </Tabs>
      )}
      {suites.data && <StartRunDialog open={open} onOpenChange={setOpen} suites={suites.data} />}
    </LabShell>
  );
}

function SuitesView({ suites }: { suites: SuiteOut[] }) {
  const [expanded, setExpanded] = React.useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {suites.map((s) => {
        const categories = [...new Set(s.cases.map((c) => c.category))];
        return (
          <LabPanel
            key={s.name}
            title={s.name}
            meta={`${s.cases.length} cases · ${categories.length} categories`}
            bodyClassName="p-0"
          >
            <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-3">
              {categories.map((c) => (
                <Badge key={c} tone="neutral" variant="outline">
                  {humanize(c)} · {s.cases.filter((x) => x.category === c).length}
                </Badge>
              ))}
            </div>
            <ul className="divide-y divide-line">
              {s.cases.map((c) => {
                const open = expanded === `${s.name}:${c.id}`;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => setExpanded(open ? null : `${s.name}:${c.id}`)}
                      aria-expanded={open}
                      className="flex w-full flex-col gap-1 px-4 py-3 text-left outline-none hover:bg-white/[0.02] focus-visible:bg-white/[0.04] sm:flex-row sm:items-start sm:gap-4"
                    >
                      <span className="w-72 shrink-0 font-mono text-xs text-fg">{c.id}</span>
                      <span className="min-w-0 flex-1 text-[13px] text-fg-muted">{c.description}</span>
                      <Badge tone="neutral" variant="outline" className="self-start">
                        {humanize(c.category)}
                      </Badge>
                    </button>
                    {open && (
                      <div className="px-4 pb-4">
                        <div className="rounded-lg border border-line bg-bg/60 p-3">
                          <div className="mb-1 text-2xs tracking-wider text-fg-subtle uppercase">
                            Goal given to the agent
                          </div>
                          <p className="text-[13px] text-fg">{c.goal}</p>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </LabPanel>
        );
      })}
    </div>
  );
}
