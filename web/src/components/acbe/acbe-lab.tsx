"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRightIcon, BugIcon, DnaIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { acbeApi, normalizeError, type CandidateOut, type FailurePatternOut } from "@/lib/api";
import { humanize, humanizeTool } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { useUiStore } from "@/stores/ui";
import { LabHeader, LabPanel, LabShell, LabStatusBadge } from "@/components/evaluations/lab";
import { CANDIDATE_STATUS, CANDIDATE_STATUSES, statusMeta } from "@/components/evaluations/lab-status";
import { PipelineOverview } from "./pipeline";
import { pipelineOverview } from "./pipeline-state";

const ALL = "__all";

export function AcbeLab() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "failures" ? "failures" : "candidates";
  const statusParam = params.get("status");
  const status = statusParam && (CANDIDATE_STATUSES as readonly string[]).includes(statusParam) ? statusParam : null;

  const failures = useQuery({
    queryKey: qk.acbe.failures,
    queryFn: ({ signal }) => acbeApi.failures({ signal }),
    staleTime: 60_000,
  });
  const overviewQuery = { limit: 200 } as const;
  const overview = useQuery({
    queryKey: qk.acbe.candidates(overviewQuery),
    queryFn: ({ signal }) => acbeApi.candidates(overviewQuery, { signal }),
    refetchInterval: (q) => (q.state.data?.items.some((c) => c.status === "evaluating") ? 5000 : 60_000),
  });
  const listQuery = { status, limit: 50 };
  const list = useCursorQuery<CandidateOut>({
    queryKey: qk.acbe.candidates(listQuery),
    fetchPage: (cursor, signal) => acbeApi.candidates({ ...listQuery, cursor }, { signal }),
    staleTime: 15_000,
  });

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const forbidden = [failures.error, overview.error, list.error].some(
    (e) => e && normalizeError(e).kind === "forbidden",
  );
  const allCandidates = overview.data?.items ?? [];
  const counts = pipelineOverview(failures.data ?? [], allCandidates);
  const attention = allCandidates.filter((c) => c.status === "passed" || c.status === "canary");
  const candidateByFingerprint = new Map(allCandidates.map((c) => [c.failure_fingerprint, c]));

  return (
    <LabShell>
      <LabHeader
        path="acbe"
        icon={<DnaIcon />}
        title="ACBE Lab"
        description={
          <>
            Adaptive Counterfactual Browser Evolution: AgentOS learns from{" "}
            <em className="text-fg not-italic">verified</em> failures. It fingerprints them, proposes bounded strategy
            changes — configuration only, never code, permissions or policy — tests them against the current strategy,
            and only a person can put one into production.
          </>
        }
      />
      {forbidden ? (
        <ErrorState error={[failures.error, overview.error, list.error].find(Boolean)} />
      ) : (
        <div className="flex flex-col gap-5">
          <LabPanel
            title="Evolution pipeline"
            meta={overview.data?.has_more ? "latest 200 candidates" : undefined}
            actions={
              <span className="hidden items-center gap-1.5 text-2xs text-fg-subtle sm:flex">
                <ShieldCheckIcon className="size-3.5 text-success" aria-hidden /> every promotion is human-approved
              </span>
            }
          >
            {failures.isLoading || overview.isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : (
              <PipelineOverview counts={counts} />
            )}
          </LabPanel>

          {attention.length > 0 && (
            <LabPanel title="Needs a decision" meta={`${attention.length}`} bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {attention.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/app/acbe/candidates/${c.id}`}
                      className="flex flex-col gap-1 px-4 py-3 hover:bg-white/[0.02] sm:flex-row sm:items-center sm:gap-4"
                    >
                      <LabStatusBadge meta={statusMeta(CANDIDATE_STATUS, c.status)} />
                      <span className="font-mono text-xs text-fg">{c.version_label}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-fg-muted">
                        {c.status === "passed"
                          ? "Passed evaluation — approve a canary or withdraw it."
                          : `On canary at ${c.rollout_percentage}% — promote after observation or roll back.`}
                      </span>
                      <ArrowRightIcon className="hidden size-4 text-fg-subtle sm:block" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </LabPanel>
          )}

          <Tabs value={tab} onValueChange={(v) => setParam("tab", v === "failures" ? "failures" : null)}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <TabsList>
                <TabsTrigger value="candidates">
                  <DnaIcon /> Candidates
                </TabsTrigger>
                <TabsTrigger value="failures">
                  <BugIcon /> Failure patterns{" "}
                  {failures.data ? (
                    <span className="font-mono text-2xs text-fg-subtle">{failures.data.length}</span>
                  ) : null}
                </TabsTrigger>
              </TabsList>
              {tab === "candidates" && (
                <Select value={status ?? ALL} onValueChange={(v) => setParam("status", v === ALL ? null : v)}>
                  <SelectTrigger className="h-8 w-52" aria-label="Filter candidates by status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All statuses</SelectItem>
                    {CANDIDATE_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {statusMeta(CANDIDATE_STATUS, s).label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <TabsContent value="candidates">
              <CandidatesTable
                list={list}
                filtered={status !== null}
                onClear={() => setParam("status", null)}
                onOpen={(c) => router.push(`/app/acbe/candidates/${c.id}`)}
              />
            </TabsContent>
            <TabsContent value="failures">
              <FailuresTable
                failures={failures.data}
                loading={failures.isLoading}
                error={failures.error}
                onRetry={() => void failures.refetch()}
                candidateByFingerprint={candidateByFingerprint}
              />
            </TabsContent>
          </Tabs>
        </div>
      )}
    </LabShell>
  );
}

function CandidatesTable({
  list,
  filtered,
  onClear,
  onOpen,
}: {
  list: ReturnType<typeof useCursorQuery<CandidateOut>>;
  filtered: boolean;
  onClear: () => void;
  onOpen: (c: CandidateOut) => void;
}) {
  const columns: Column<CandidateOut>[] = [
    {
      id: "status",
      header: "Status",
      className: "w-48",
      cell: (c) => <LabStatusBadge meta={statusMeta(CANDIDATE_STATUS, c.status)} />,
    },
    {
      id: "label",
      header: "Candidate",
      cell: (c) => (
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] text-fg">{c.version_label}</div>
          <div className="mt-0.5 max-w-md truncate text-xs text-fg-subtle">{c.rationale}</div>
        </div>
      ),
    },
    {
      id: "type",
      header: "Addresses",
      hideBelow: "md",
      cell: (c) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-fg">{humanize(c.failure_type)}</span>
          <span className="font-mono text-2xs text-fg-subtle">{c.scope}</span>
        </div>
      ),
    },
    {
      id: "rollout",
      header: "Rollout",
      hideBelow: "sm",
      cell: (c) => (
        <span className="font-mono text-xs text-fg-muted tabular-nums">
          {c.rollout_percentage ? `${c.rollout_percentage}%` : "—"}
        </span>
      ),
    },
    {
      id: "scope",
      header: "Scope",
      hideBelow: "lg",
      cell: (c) =>
        c.tenant_id === null ? (
          <Badge tone="verify">Platform-wide</Badge>
        ) : (
          <span className="text-xs text-fg-muted">This organization</span>
        ),
    },
    {
      id: "created",
      header: "Proposed",
      hideBelow: "lg",
      cell: (c) => <RelativeTime value={c.created_at} className="text-xs text-fg-muted" />,
    },
  ];
  return (
    <DataTable
      caption="Strategy candidates"
      columns={columns}
      rows={list.items}
      rowKey={(c) => c.id}
      isLoading={list.isLoading}
      error={list.error}
      onRetry={() => void list.refetch()}
      onRowClick={onOpen}
      hasMore={list.hasNextPage}
      onLoadMore={() => void list.fetchNextPage()}
      isLoadingMore={list.isFetchingNextPage}
      empty={
        filtered ? (
          <EmptyState
            size="sm"
            icon={<DnaIcon />}
            title="No candidates in this status"
            action={
              <button type="button" onClick={onClear} className="text-xs text-accent hover:underline">
                Show all candidates
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<DnaIcon />}
            title="No strategy candidates yet"
            description="When a learnable failure pattern becomes significant — the same verified failure across several tasks — ACBE proposes a candidate strategy here and queues its evaluation. Winning experiments also appear here when you roll them out."
          />
        )
      }
    />
  );
}

function FailuresTable({
  failures,
  loading,
  error,
  onRetry,
  candidateByFingerprint,
}: {
  failures: FailurePatternOut[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  candidateByFingerprint: Map<string, CandidateOut>;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const columns: Column<FailurePatternOut>[] = [
    {
      id: "pattern",
      header: "Pattern",
      cell: (f) => (
        <div className="max-w-md min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-medium text-fg">{humanize(f.failure_type)}</span>
            {f.tool_name && (
              <span className="font-mono text-2xs text-fg-subtle" title={humanizeTool(f.tool_name)}>
                {f.tool_name}
              </span>
            )}
          </div>
          <Tooltip content={<span className="break-words">{f.sample_message}</span>}>
            <div tabIndex={0} className="mt-0.5 truncate text-xs text-fg-subtle outline-none">
              {f.sample_message}
            </div>
          </Tooltip>
          {developerMode && <div className="mt-0.5 font-mono text-2xs text-fg-subtle">{f.fingerprint}</div>}
        </div>
      ),
    },
    {
      id: "error",
      header: "Error",
      hideBelow: "lg",
      cell: (f) => (
        <div className="flex flex-col gap-0.5 font-mono text-2xs">
          <span className="text-fg-muted">{f.error_class}</span>
          <span className="text-fg-subtle">{f.error_code}</span>
        </div>
      ),
    },
    {
      id: "count",
      header: "Seen",
      cell: (f) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-xs text-fg tabular-nums">{f.occurrences}×</span>
          <span className="text-2xs text-fg-subtle">
            {f.tasks} {f.tasks === 1 ? "task" : "tasks"}
          </span>
        </div>
      ),
    },
    {
      id: "signal",
      header: "Signal",
      hideBelow: "sm",
      cell: (f) => (
        <div className="flex flex-wrap gap-1">
          <Badge
            tone={f.significant ? "verify" : "neutral"}
            title={f.significant ? "Frequent enough to act on" : "Not frequent enough yet"}
          >
            {f.significant ? "Significant" : "Watching"}
          </Badge>
          <Badge
            tone={f.learnable ? "success" : "neutral"}
            variant="outline"
            title={f.learnable ? "A strategy change can address it" : "Not addressable by strategy (e.g. permissions)"}
          >
            {f.learnable ? "Learnable" : "Not learnable"}
          </Badge>
        </div>
      ),
    },
    {
      id: "last",
      header: "Last seen",
      hideBelow: "md",
      cell: (f) => <RelativeTime value={f.last_seen} className="text-xs text-fg-muted" />,
    },
    {
      id: "candidate",
      header: "Candidate",
      hideBelow: "md",
      cell: (f) => {
        const c = candidateByFingerprint.get(f.fingerprint);
        return c ? (
          <Link href={`/app/acbe/candidates/${c.id}`} className="font-mono text-2xs text-accent hover:underline">
            {c.version_label}
          </Link>
        ) : (
          <span className="text-2xs text-fg-subtle">—</span>
        );
      },
    },
  ];
  return (
    <DataTable
      caption="Verified failure patterns"
      columns={columns}
      rows={failures ?? []}
      rowKey={(f) => f.fingerprint}
      isLoading={loading}
      error={error}
      onRetry={onRetry}
      empty={
        <EmptyState
          icon={<BugIcon />}
          title="No verified failure patterns"
          description="ACBE only learns from failures that were verified against the external system — not from guesses. When tasks fail in a repeatable way, their fingerprints collect here."
        />
      }
    />
  );
}
