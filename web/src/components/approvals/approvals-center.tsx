"use client";

/**
 * Approval Center: pending decisions and history (backend `status` filter), keyset pagination,
 * deep link `?focus=<approval id>` (scrolls to and highlights the card, fetching it when it is not
 * on the loaded page). Kept live by the user stream (approval events invalidate these lists).
 */
import { useQuery } from "@tanstack/react-query";
import { HistoryIcon, ShieldCheckIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { approvalsApi, type ApprovalOut, type ApprovalStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/controls";
import { Label } from "@/components/ui/field";
import { PageContainer, PageHeader } from "@/components/ui/page";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { approvalStatusMeta } from "@/lib/status";
import { ApprovalCard } from "./approval-card";

const PAGE = 20;
const HISTORY_FILTERS: Array<{ value: "all" | Exclude<ApprovalStatus, "pending">; label: string }> = [
  { value: "all", label: "All decisions" },
  { value: "approved", label: approvalStatusMeta.approved.label },
  { value: "rejected", label: approvalStatusMeta.rejected.label },
  { value: "expired", label: approvalStatusMeta.expired.label },
  { value: "cancelled", label: approvalStatusMeta.cancelled.label },
];

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-5" aria-hidden>
      <div className="flex gap-3">
        <Skeleton className="size-9 rounded-lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      </div>
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

export function ApprovalsCenter() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab = params.get("tab") === "history" ? "history" : "pending";
  const historyParam = params.get("status");
  const historyStatus = HISTORY_FILTERS.some((f) => f.value === historyParam)
    ? (historyParam as (typeof HISTORY_FILTERS)[number]["value"])
    : "all";
  const focus = params.get("focus");

  const setParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const status = tab === "pending" ? "pending" : historyStatus === "all" ? undefined : historyStatus;
  const query = { status, limit: PAGE };
  const list = useCursorQuery<ApprovalOut>({
    queryKey: [...qk.approvals.list(query), "infinite"],
    fetchPage: (cursor, signal) => approvalsApi.list({ ...query, cursor }, { signal }),
    staleTime: 10_000,
  });
  // History "all" also returns pending items; keep them on the Pending tab.
  const items = tab === "history" ? list.items.filter((a) => a.status !== "pending") : list.items;

  const focusedInList = focus ? items.some((a) => a.id === focus) : false;
  const focused = useQuery({
    queryKey: qk.approvals.detail(focus ?? "none"),
    queryFn: ({ signal }) => approvalsApi.get(focus!, { signal }),
    enabled: Boolean(focus) && !list.isLoading && !focusedInList,
  });

  const [highlight, setHighlight] = React.useState<string | null>(focus);
  React.useEffect(() => {
    if (!focus || list.isLoading) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`approval-${focus}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        (el as HTMLElement).focus?.({ preventScroll: true });
      }
    }, 120);
    const clear = setTimeout(() => setHighlight(null), 4000);
    return () => {
      clearTimeout(t);
      clearTimeout(clear);
    };
  }, [focus, list.isLoading, focused.data]);

  const extra = focus && !focusedInList && focused.data ? focused.data : null;

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Approvals"
        description="Actions that affect other people or are hard to undo wait here for you. AgentOS never runs them without a decision."
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tabs
          value={tab}
          onValueChange={(v) => setParams({ tab: v === "history" ? "history" : null, status: null, focus: null })}
        >
          <TabsList aria-label="Approval views">
            <TabsTrigger value="pending">
              <ShieldCheckIcon /> Pending
            </TabsTrigger>
            <TabsTrigger value="history">
              <HistoryIcon /> History
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {tab === "history" && (
          <div className="flex items-center gap-2 sm:ml-auto">
            <Label htmlFor="approval-history-filter" className="text-xs text-fg-muted">
              Show
            </Label>
            <Select value={historyStatus} onValueChange={(v) => setParams({ status: v === "all" ? null : v })}>
              <SelectTrigger id="approval-history-filter" className="h-8 w-44 text-[13px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HISTORY_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {extra && (
        <div className="mb-5">
          <p className="mb-2 text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">Linked approval</p>
          <ApprovalCard approval={extra} showTaskLink highlighted={highlight === extra.id} />
        </div>
      )}
      {focus && !focusedInList && focused.error ? (
        <ErrorState error={focused.error} compact title="That approval isn't available" className="mb-5" />
      ) : null}

      <div aria-live="polite" className="sr-only">
        {tab === "pending" && !list.isLoading
          ? `${items.length} pending approval${items.length === 1 ? "" : "s"}${list.hasNextPage ? " or more" : ""}`
          : ""}
      </div>

      {list.error && items.length === 0 ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.isLoading ? (
        <div className="flex flex-col gap-4" aria-busy>
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : items.length === 0 ? (
        tab === "pending" ? (
          <EmptyState
            size="lg"
            icon={<ShieldCheckIcon />}
            title="Nothing needs your approval"
            description="When a task wants to send, share, schedule with others or do anything hard to undo, it pauses and asks you here first."
            action={
              <Button asChild variant="secondary" size="sm">
                <Link href="/app/tasks">View tasks</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<HistoryIcon />}
            title="No decisions yet"
            description="Approved, rejected and expired requests are kept here as a record."
          />
        )
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((a) => (
            <li key={a.id}>
              <ApprovalCard approval={a} showTaskLink highlighted={highlight === a.id} compact={tab === "history"} />
            </li>
          ))}
        </ul>
      )}

      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
