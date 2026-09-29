"use client";

/**
 * Tasks list: newest first, keyset pagination, status filter (backend `status`), organization-wide
 * view for `tasks:read_all`. Kept live by the user stream (list queries are invalidated).
 */
import { ListChecksIcon, PlusIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { tasksApi, taskStatusValues, type TaskOut, type TaskStatus } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Skeleton, Switch } from "@/components/ui/controls";
import { Label } from "@/components/ui/field";
import { PageContainer, PageHeader } from "@/components/ui/page";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { useCursorQuery } from "@/lib/query/pagination";
import { taskStatusMeta } from "@/lib/status";
import { useUiStore } from "@/stores/ui";
import { useAgentsIndex } from "./hooks";
import { TaskRow } from "./task-row";

const PAGE = 25;
const ALL = "all";

const GROUPS: Array<{ label: string; values: TaskStatus[] }> = [
  { label: "Needs you", values: ["waiting_approval", "waiting_input", "requires_reconciliation", "blocked"] },
  {
    label: "In progress",
    values: [
      "created",
      "planning",
      "planned",
      "validating",
      "queued",
      "running",
      "verifying",
      "recovering",
      "cancel_requested",
      "paused",
    ],
  },
  { label: "Finished", values: ["completed", "failed", "expired", "cancelled"] },
];

function isStatus(v: string | null): v is TaskStatus {
  return v !== null && (taskStatusValues as readonly string[]).includes(v);
}

export function TasksList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { can } = usePermissions();
  const focusComposer = useUiStore((s) => s.focusComposer);
  const statusParam = params.get("status");
  const status = isStatus(statusParam) ? statusParam : null;
  const allUsers = params.get("scope") === "org" && can("tasks:read_all");
  const agents = useAgentsIndex();

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const query = { status: status ?? undefined, all_users: allUsers || undefined, limit: PAGE };
  const list = useCursorQuery<TaskOut>({
    queryKey: [...qk.tasks.list(query), "infinite"],
    fetchPage: (cursor, signal) => tasksApi.list({ ...query, cursor }, { signal }),
    staleTime: 15_000,
  });

  const newTask = (
    <Button variant="primary" asChild>
      <Link href="/app" onClick={() => setTimeout(focusComposer, 50)}>
        <PlusIcon /> New task
      </Link>
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        description="Everything your agents are working on — live status, progress and outcomes."
        actions={newTask}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor="task-status-filter" className="text-xs text-fg-muted">
            Status
          </Label>
          <Select value={status ?? ALL} onValueChange={(v) => setParam("status", v === ALL ? null : v)}>
            <SelectTrigger id="task-status-filter" className="h-8 w-52 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All statuses</SelectItem>
              {GROUPS.map((g) => (
                <SelectGroup key={g.label}>
                  <SelectLabel>{g.label}</SelectLabel>
                  {g.values.map((v) => (
                    <SelectItem key={v} value={v}>
                      {taskStatusMeta[v].label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        {can("tasks:read_all") && (
          <div className="flex items-center gap-2 sm:ml-auto">
            <Switch id="org-tasks" checked={allUsers} onCheckedChange={(on) => setParam("scope", on ? "org" : null)} />
            <Label htmlFor="org-tasks" className="text-[13px] font-normal text-fg-muted">
              All organization tasks
            </Label>
          </div>
        )}
      </div>

      {list.error && list.items.length === 0 ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
          <div className="hidden grid-cols-[minmax(0,1fr)_9.5rem_7rem_8rem_1rem] gap-x-4 border-b border-line px-4 py-2 text-2xs font-medium tracking-wider text-fg-subtle uppercase md:grid">
            <span>Goal</span>
            <span>Status</span>
            <span>Progress</span>
            <span>Activity</span>
            <span />
          </div>
          {list.isLoading ? (
            <ul aria-busy>
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex items-center gap-4 border-b border-line px-4 py-4 last:border-0">
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-3 w-2/5" />
                  </div>
                  <Skeleton className="h-5 w-24 rounded-full" />
                </li>
              ))}
            </ul>
          ) : list.items.length === 0 ? (
            status ? (
              <EmptyState
                icon={<ListChecksIcon />}
                title={`No tasks are “${taskStatusMeta[status].label.toLowerCase()}”`}
                description="Tasks move through statuses as they run; try another filter."
                action={
                  <Button size="sm" variant="secondary" onClick={() => setParam("status", null)}>
                    Show all tasks
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<SparklesIcon />}
                title="Your agents are ready."
                description="Give AgentOS something worth doing — it plans, asks before anything risky, runs it and verifies the result."
                action={newTask}
              />
            )
          ) : (
            <ul className="divide-y divide-line">
              {list.items.map((t) => (
                <li key={t.task_id}>
                  <TaskRow task={t} agents={agents.index} />
                </li>
              ))}
            </ul>
          )}
          {list.hasNextPage && (
            <div className="flex justify-center border-t border-line p-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void list.fetchNextPage()}
                loading={list.isFetchingNextPage}
              >
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  );
}
