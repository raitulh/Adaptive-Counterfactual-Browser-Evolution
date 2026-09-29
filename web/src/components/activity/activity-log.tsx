"use client";

import { useQuery } from "@tanstack/react-query";
import { ActivityIcon, ArrowUpRightIcon, FilterXIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/data-display";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { auditApi, normalizeError, organizationsApi, type AuditOut, type MemberOut } from "@/lib/api";
import { useOrganization } from "@/lib/auth/hooks";
import { humanize } from "@/lib/format";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { ActorLabel, AuditDetailSheet } from "./audit-detail-sheet";
import {
  activeFilterCount,
  AUDIT_CATEGORIES,
  auditStatusTone,
  CATEGORY_LABEL,
  CATEGORY_TONE,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  filtersToQuery,
  isUuid,
  type AuditFilters,
} from "./audit-meta";

const ANY = "__any";

export function ActivityLog() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { organization } = useOrganization();
  const filters = React.useMemo(() => filtersFromParams(new URLSearchParams(params.toString())), [params]);
  const query = filtersToQuery(filters);
  const [selected, setSelected] = React.useState<AuditOut | null>(null);

  const audit = useCursorQuery<AuditOut>({
    queryKey: qk.audit.list(query),
    fetchPage: (cursor, signal) => auditApi.list({ ...query, cursor }, { signal }),
    staleTime: 15_000,
  });
  const members = useQuery({
    queryKey: qk.organization.members,
    queryFn: ({ signal }) => organizationsApi.members({ signal }),
    staleTime: 60_000,
  });
  const memberByUser = React.useMemo(() => new Map((members.data ?? []).map((m) => [m.user_id, m])), [members.data]);

  const setFilters = (next: AuditFilters) => {
    const qs = filtersToParams(next, new URLSearchParams(params.toString())).toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const forbidden = audit.error && normalizeError(audit.error).kind === "forbidden";
  const count = activeFilterCount(filters);

  const columns: Column<AuditOut>[] = [
    {
      id: "time",
      header: "When",
      hideBelow: "sm",
      className: "w-28 whitespace-nowrap",
      cell: (e) => <RelativeTime value={e.created_at} className="text-fg-muted" />,
    },
    {
      id: "event",
      header: "Event",
      cell: (e) => (
        <div className="max-w-[26rem] min-w-0">
          <div className="truncate font-mono text-[12.5px] text-fg">{e.action}</div>
          {e.result_summary && <div className="truncate text-xs text-fg-subtle">{e.result_summary}</div>}
          <div className="mt-1 flex items-center gap-2 text-2xs text-fg-subtle sm:hidden">
            <RelativeTime value={e.created_at} />
            <Badge tone={auditStatusTone(e.status)}>{humanize(e.status)}</Badge>
          </div>
        </div>
      ),
    },
    {
      id: "actor",
      header: "Actor",
      hideBelow: "md",
      className: "max-w-56",
      cell: (e) => <ActorLabel entry={e} member={e.user_id ? memberByUser.get(e.user_id) : undefined} />,
    },
    {
      id: "resource",
      header: "Resource",
      hideBelow: "lg",
      cell: (e) =>
        e.tool_name ? (
          <span className="font-mono text-xs text-fg-muted">{e.tool_name}</span>
        ) : e.resource_type ? (
          <span className="text-xs text-fg-muted">{humanize(e.resource_type)}</span>
        ) : (
          <span className="text-fg-subtle">—</span>
        ),
    },
    {
      id: "category",
      header: "Category",
      hideBelow: "sm",
      cell: (e) => (
        <Badge tone={CATEGORY_TONE[e.category] ?? "neutral"} variant="outline">
          {CATEGORY_LABEL[e.category] ?? humanize(e.category)}
        </Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      hideBelow: "sm",
      cell: (e) => <Badge tone={auditStatusTone(e.status)}>{humanize(e.status)}</Badge>,
    },
    {
      id: "task",
      header: <span className="sr-only">Task</span>,
      hideBelow: "md",
      className: "w-20 text-right",
      cell: (e) =>
        e.task_id ? (
          <Link
            href={`/app/tasks/${e.task_id}`}
            onClick={(ev) => ev.stopPropagation()}
            className="inline-flex items-center gap-0.5 text-xs text-accent hover:underline"
          >
            Task <ArrowUpRightIcon className="size-3" aria-hidden />
          </Link>
        ) : null,
    },
  ];

  return (
    <PageContainer width="wide">
      <PageHeader
        eyebrow="Enterprise audit"
        title="Activity"
        description={
          <>
            An append-only record of sign-ins, approvals, tool actions and administrative changes
            {organization ? (
              <>
                {" "}
                in <span className="font-medium text-fg">{organization.name}</span>
              </>
            ) : null}
            . Entries can&apos;t be edited or deleted.
          </>
        }
        actions={
          !forbidden && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void audit.refetch()}
              loading={audit.isRefetching && !audit.isFetchingNextPage}
            >
              <RefreshCwIcon /> Refresh
            </Button>
          )
        }
      />
      {forbidden ? (
        <ErrorState error={audit.error} />
      ) : (
        <div className="flex flex-col gap-4">
          <FilterBar filters={filters} members={members.data ?? []} onChange={setFilters} count={count} />
          <div aria-live="polite" className="sr-only">
            {audit.isLoading
              ? "Loading activity"
              : `${audit.items.length} entries shown${audit.hasNextPage ? ", more available" : ""}`}
          </div>
          <DataTable
            caption="Audit log entries"
            columns={columns}
            rows={audit.items}
            rowKey={(e) => e.id}
            isLoading={audit.isLoading}
            error={audit.error}
            onRetry={() => void audit.refetch()}
            onRowClick={setSelected}
            hasMore={audit.hasNextPage}
            onLoadMore={() => void audit.fetchNextPage()}
            isLoadingMore={audit.isFetchingNextPage}
            empty={
              count > 0 ? (
                <EmptyState
                  icon={<SearchIcon />}
                  title="No entries match these filters"
                  description="Filters match exactly (for example the action must be the full name, like auth.login)."
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                      <FilterXIcon /> Clear filters
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon={<ActivityIcon />}
                  title="Nothing recorded yet"
                  description="Sign-ins, task actions, approvals and settings changes will appear here as they happen."
                />
              )
            }
          />
        </div>
      )}
      <AuditDetailSheet
        entry={selected}
        member={selected?.user_id ? memberByUser.get(selected.user_id) : undefined}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </PageContainer>
  );
}

function FilterBar({
  filters,
  members,
  onChange,
  count,
}: {
  filters: AuditFilters;
  members: MemberOut[];
  onChange: (f: AuditFilters) => void;
  count: number;
}) {
  const [action, setAction] = React.useState(filters.action ?? "");
  const [taskId, setTaskId] = React.useState(filters.task_id ?? "");
  const [taskError, setTaskError] = React.useState<string | null>(null);
  const [synced, setSynced] = React.useState(filters);
  // Adopt external URL changes (back/forward, "clear filters") without an effect.
  if (synced !== filters) {
    setSynced(filters);
    setAction(filters.action ?? "");
    setTaskId(filters.task_id ?? "");
    setTaskError(null);
  }

  const commitAction = () => {
    const v = action.trim();
    if ((v || null) !== filters.action) onChange({ ...filters, action: v || null });
  };
  const commitTask = () => {
    const v = taskId.trim();
    if (v && !isUuid(v)) {
      setTaskError("Paste a full task ID");
      return;
    }
    setTaskError(null);
    if ((v.toLowerCase() || null) !== filters.task_id) onChange({ ...filters, task_id: v ? v.toLowerCase() : null });
  };
  const userKnown = !filters.user_id || members.some((m) => m.user_id === filters.user_id);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-3 lg:flex-row lg:items-start">
      <div className="grid flex-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Category</span>
          <Select
            value={filters.category ?? ANY}
            onValueChange={(v) => onChange({ ...filters, category: v === ANY ? null : v })}
          >
            <SelectTrigger aria-label="Filter by category" className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>All categories</SelectItem>
              {AUDIT_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </SelectItem>
              ))}
              {filters.category && !(AUDIT_CATEGORIES as readonly string[]).includes(filters.category) && (
                <SelectItem value={filters.category}>{humanize(filters.category)}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Action</span>
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onBlur={commitAction}
            onKeyDown={(e) => e.key === "Enter" && commitAction()}
            placeholder="e.g. auth.login"
            maxLength={100}
            className="h-8 font-mono text-xs"
            aria-label="Filter by exact action"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Member</span>
          <Select
            value={filters.user_id ?? ANY}
            onValueChange={(v) => onChange({ ...filters, user_id: v === ANY ? null : v })}
          >
            <SelectTrigger aria-label="Filter by member" className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>Anyone</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.user_id} value={m.user_id}>
                  {m.display_name || m.email}
                </SelectItem>
              ))}
              {!userKnown && filters.user_id && (
                <SelectItem value={filters.user_id}>User {filters.user_id.slice(0, 8)}…</SelectItem>
              )}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-2xs font-medium tracking-wider text-fg-subtle uppercase">Task ID</span>
          <Input
            value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value);
              setTaskError(null);
            }}
            onBlur={commitTask}
            onKeyDown={(e) => e.key === "Enter" && commitTask()}
            placeholder="Paste a task ID"
            className="h-8 font-mono text-xs"
            aria-label="Filter by task ID"
            aria-invalid={taskError ? true : undefined}
          />
          {taskError && (
            <span role="alert" className="text-2xs text-danger">
              {taskError}
            </span>
          )}
        </label>
      </div>
      <div className="flex items-center justify-between gap-2 lg:pt-5">
        <span className="text-xs text-fg-subtle lg:hidden">
          {count ? `${count} filter${count === 1 ? "" : "s"} active` : "No filters"}
        </span>
        <Button variant="ghost" size="sm" disabled={count === 0} onClick={() => onChange(EMPTY_FILTERS)}>
          <FilterXIcon /> Clear
        </Button>
      </div>
    </div>
  );
}
