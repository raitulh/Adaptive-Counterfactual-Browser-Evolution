"use client";

/**
 * Command Center: the composer front and centre, then what is running now, what needs you
 * (pending approvals + tasks waiting for input, confirmation or unblocking) and recent results.
 * Every list is a real query, kept live by the user stream (list queries are invalidated).
 */
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  HandIcon,
  MessageSquareTextIcon,
  PlugIcon,
  SparklesIcon,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { approvalsApi, tasksApi, type ApprovalOut, type TaskOut, type TaskStatus } from "@/lib/api";
import { RiskBadge, StatusBadge } from "@/components/ui/badge";
import { Progress, Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { PageContainer } from "@/components/ui/page";
import { EmptyState, ErrorState } from "@/components/ui/states";
import { useCurrentUser, usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import { isTaskActive, taskStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useAgentsIndex, useNow } from "@/components/tasks/hooks";
import { taskAgentName } from "@/components/tasks/task-row";
import { remainingLabel } from "@/components/approvals/decision";
import { Elapsed } from "@/components/tasks/elapsed";
import { CoreVisual, type CoreState } from "./core-visual";
import { TaskComposer } from "./task-composer";
import { readable } from "@/components/tasks/timeline/readable";

const NEEDS_STATUSES: TaskStatus[] = ["waiting_input", "requires_reconciliation", "blocked"];
const FINISHED: TaskStatus[] = ["completed", "failed", "cancelled", "expired"];

function greeting(date = new Date()): string {
  const h = date.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function SectionTitle({
  children,
  count,
  href,
  linkLabel,
}: {
  children: React.ReactNode;
  count?: number;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <h2 className="text-sm font-semibold tracking-tight text-fg">{children}</h2>
      {count !== undefined && count > 0 && (
        <span className="rounded-full bg-white/[0.06] px-1.5 text-2xs text-fg-muted tabular-nums">{count}</span>
      )}
      {href && (
        <Link
          href={href}
          className="ml-auto inline-flex items-center gap-1 rounded text-xs text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
        >
          {linkLabel ?? "View all"} <ArrowRightIcon className="size-3" aria-hidden />
        </Link>
      )}
    </div>
  );
}

function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16 w-full rounded-xl" />
      ))}
    </div>
  );
}

function ActiveCard({ task, agentName }: { task: TaskOut; agentName: string }) {
  const meta = taskStatusMeta[task.status];
  return (
    <Link
      href={`/app/tasks/${task.task_id}`}
      className="group flex flex-col gap-2.5 rounded-xl border border-accent/15 bg-surface-1 p-3.5 transition-colors outline-none hover:border-accent/35 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 text-[13.5px] leading-snug font-medium text-fg">{task.goal}</p>
        <StatusBadge kind="task" value={task.status} className="shrink-0" />
      </div>
      <div className="flex items-center gap-2">
        <Progress
          value={Math.round(task.progress * 100)}
          tone={meta.tone === "neutral" ? "accent" : meta.tone}
          className="h-1"
          label="Progress"
        />
        <span className="font-mono text-2xs text-fg-subtle tabular-nums">{Math.round(task.progress * 100)}%</span>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
        {agentName} · <Elapsed task={task} className="text-fg-muted" /> elapsed
      </p>
    </Link>
  );
}

function ApprovalRow({ approval }: { approval: ApprovalOut }) {
  const now = useNow(15_000);
  const r = remainingLabel(approval.expires_at, now);
  return (
    <Link
      href={`/app/approvals?focus=${approval.id}`}
      className="group flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/[0.03] p-3.5 transition-colors outline-none hover:border-warning/45 hover:bg-warning/[0.06] focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <span
        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-warning/35 bg-warning/10 text-warning"
        aria-hidden
      >
        <HandIcon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-fg">Approve: {readable(approval.summary)}</span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-subtle">
          <RiskBadge level={approval.risk_level} />
          <span className={cn(r.urgent && "text-warning")}>{r.label}</span>
        </span>
      </span>
      <span className="self-center text-xs font-medium text-warning opacity-80 group-hover:opacity-100">Review</span>
    </Link>
  );
}

const NEEDS_COPY: Partial<Record<TaskStatus, { action: string; icon: React.ComponentType<{ className?: string }> }>> = {
  waiting_input: { action: "Answer", icon: MessageSquareTextIcon },
  requires_reconciliation: { action: "Confirm outcome", icon: CircleAlertIcon },
  blocked: { action: "Unblock", icon: PlugIcon },
};

function NeedsTaskRow({ task }: { task: TaskOut }) {
  const copy = NEEDS_COPY[task.status] ?? { action: "Open", icon: CircleAlertIcon };
  const meta = taskStatusMeta[task.status];
  const Icon = copy.icon;
  const detail =
    task.status === "waiting_input" ? task.pending_questions?.[0] : (task.failure_message ?? meta.description);
  return (
    <Link
      href={`/app/tasks/${task.task_id}`}
      className={cn(
        "group flex items-start gap-3 rounded-xl border bg-surface-1 p-3.5 transition-colors outline-none hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50",
        meta.tone === "danger"
          ? "border-danger/25 hover:border-danger/45"
          : meta.tone === "recover"
            ? "border-recover/25 hover:border-recover/45"
            : "border-warning/25 hover:border-warning/45",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border",
          meta.tone === "danger"
            ? "border-danger/35 bg-danger/10 text-danger"
            : meta.tone === "recover"
              ? "border-recover/35 bg-recover/10 text-recover"
              : "border-warning/35 bg-warning/10 text-warning",
        )}
        aria-hidden
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">{task.goal}</span>
        {detail && <span className="mt-0.5 line-clamp-2 block text-xs text-fg-muted">{readable(detail)}</span>}
        <span className="mt-1.5 block">
          <StatusBadge kind="task" value={task.status} />
        </span>
      </span>
      <span className="self-center text-xs font-medium text-fg-muted group-hover:text-fg">{copy.action}</span>
    </Link>
  );
}

function RecentRow({ task }: { task: TaskOut }) {
  const meta = taskStatusMeta[task.status];
  return (
    <li>
      <Link
        href={`/app/tasks/${task.task_id}`}
        className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors outline-none hover:bg-white/[0.03] focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {task.status === "completed" ? (
          <CheckCircle2Icon className="size-4 shrink-0 text-success" aria-hidden />
        ) : (
          <CircleAlertIcon
            className={cn("size-4 shrink-0", meta.tone === "danger" ? "text-danger" : "text-fg-subtle")}
            aria-hidden
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-fg">{task.goal}</span>
          <span className="block truncate text-xs text-fg-subtle">
            {meta.label} · <RelativeTime value={task.completed_at ?? task.updated_at} />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function CommandCenter() {
  const me = useCurrentUser();
  const { can } = usePermissions();
  const canRead = can("tasks:read");
  const agents = useAgentsIndex();

  const recent = useQuery({
    queryKey: qk.tasks.list({ limit: 30 }),
    queryFn: ({ signal }) => tasksApi.list({ limit: 30 }, { signal }),
    enabled: canRead,
    staleTime: 10_000,
  });
  const needs = useQuery({
    queryKey: [...qk.tasks.lists, "needs-you"],
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(NEEDS_STATUSES.map((status) => tasksApi.list({ status, limit: 10 }, { signal })));
      return pages.flatMap((p) => p.items).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    },
    enabled: canRead,
    staleTime: 10_000,
  });
  const approvals = useQuery({
    queryKey: qk.approvals.list({ status: "pending", limit: 5 }),
    queryFn: ({ signal }) => approvalsApi.list({ status: "pending", limit: 5 }, { signal }),
    staleTime: 10_000,
  });

  const items = React.useMemo(() => recent.data?.items ?? [], [recent.data]);
  const active = items.filter((t) => isTaskActive(t.status));
  const finished = items.filter((t) => FINISHED.includes(t.status)).slice(0, 6);
  const needTasks = needs.data ?? [];
  const pendingApprovals = approvals.data?.items ?? [];
  const needsCount = needTasks.length + pendingApprovals.length;
  const coreState: CoreState = needsCount > 0 ? "attention" : active.length > 0 ? "working" : "idle";
  const noTasksAtAll = recent.isSuccess && items.length === 0;
  const name = me.data?.display_name?.split(" ")[0];

  const statusLine =
    active.length === 0 && needsCount === 0
      ? "All quiet — ready for the next goal."
      : [
          active.length ? `${active.length} running` : null,
          needsCount ? `${needsCount} need${needsCount === 1 ? "s" : ""} you` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <PageContainer width="wide" className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] bg-grid [mask-image:radial-gradient(ellipse_at_top,black_20%,transparent_70%)] opacity-60"
        aria-hidden
      />

      {/* Hero */}
      <section
        className="grid items-start gap-8 pt-2 pb-10 md:grid-cols-[minmax(0,1fr)_240px] lg:grid-cols-[minmax(0,1fr)_300px] lg:pt-6"
        aria-labelledby="cc-title"
      >
        <div className="min-w-0">
          <p className="text-2xs font-medium tracking-[0.16em] text-fg-subtle uppercase" suppressHydrationWarning>
            {greeting()}
            {name ? `, ${name}` : ""}
          </p>
          <h1
            id="cc-title"
            className="mt-2 text-[28px] leading-[1.1] font-semibold tracking-[-0.03em] text-balance-safe text-fg sm:text-4xl lg:text-[44px]"
          >
            Tell AgentOS what you want done.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-fg-muted sm:text-[15px]">
            It plans the steps, asks before anything risky, runs them with your connected tools and verifies every
            result before calling it done.
          </p>
          <TaskComposer className="mt-6" />
        </div>
        <div className="hidden flex-col items-center gap-3 md:flex md:pt-2">
          <CoreVisual state={coreState} className="max-w-[300px]" />
          <p className="flex items-center gap-2 text-xs text-fg-muted" role="status" aria-live="polite">
            <span
              className={cn(
                "size-1.5 rounded-full",
                coreState === "attention"
                  ? "bg-warning"
                  : coreState === "working"
                    ? "bg-accent motion-safe:animate-signal"
                    : "bg-fg-subtle",
              )}
              aria-hidden
            />
            {statusLine}
          </p>
        </div>
      </section>

      {!canRead ? null : noTasksAtAll && pendingApprovals.length === 0 ? (
        <EmptyState
          size="md"
          className="rounded-2xl border border-dashed border-line-strong"
          icon={<SparklesIcon />}
          title="Your agents are ready. Give AgentOS something worth doing."
          description="Try “Schedule a meeting with Rahim tomorrow after 2 PM and email him a confirmation” — you'll approve anything that affects other people, and see every result verified."
        />
      ) : (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-8">
            <section aria-labelledby="cc-needs">
              <SectionTitle
                count={needsCount}
                href={pendingApprovals.length ? "/app/approvals" : undefined}
                linkLabel="All approvals"
              >
                <span id="cc-needs">Needs you</span>
              </SectionTitle>
              {needs.isLoading || approvals.isLoading ? (
                <RowsSkeleton rows={2} />
              ) : needs.error && approvals.error ? (
                <ErrorState error={needs.error} compact onRetry={() => void needs.refetch()} />
              ) : needsCount === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-line bg-surface-1/60 px-4 py-3.5 text-[13px] text-fg-muted">
                  <CheckCircle2Icon className="size-4 text-success" aria-hidden /> All clear — nothing is waiting on
                  you.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {pendingApprovals.map((a) => (
                    <ApprovalRow key={a.id} approval={a} />
                  ))}
                  {needTasks.map((t) => (
                    <NeedsTaskRow key={t.task_id} task={t} />
                  ))}
                </div>
              )}
            </section>

            <section aria-labelledby="cc-active">
              <SectionTitle count={active.length} href="/app/tasks">
                <span id="cc-active">Active now</span>
              </SectionTitle>
              {recent.isLoading ? (
                <RowsSkeleton rows={2} />
              ) : recent.error ? (
                <ErrorState error={recent.error} compact onRetry={() => void recent.refetch()} />
              ) : active.length === 0 ? (
                <p className="rounded-xl border border-line bg-surface-1/60 px-4 py-3.5 text-[13px] text-fg-muted">
                  Nothing running right now. Start something above.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {active.slice(0, 6).map((t) => (
                    <ActiveCard key={t.task_id} task={t} agentName={taskAgentName(t, agents.index)} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <section aria-labelledby="cc-recent" className="min-w-0">
            <SectionTitle href="/app/tasks">
              <span id="cc-recent">Recent results</span>
            </SectionTitle>
            {recent.isLoading ? (
              <RowsSkeleton rows={4} />
            ) : finished.length === 0 ? (
              <p className="rounded-xl border border-line bg-surface-1/60 px-4 py-3.5 text-[13px] text-fg-muted">
                Finished tasks and their verified results will appear here.
              </p>
            ) : (
              <ul className="rounded-xl border border-line bg-surface-1 p-1.5">
                {finished.map((t) => (
                  <RecentRow key={t.task_id} task={t} />
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </PageContainer>
  );
}
