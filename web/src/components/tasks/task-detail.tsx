"use client";

/**
 * Live task execution. REST (task detail, summary, approvals) is the source of truth; the task
 * stream appends durable events and invalidates those queries, so the page stays correct even if
 * the stream drops (it shows "reconnecting" and falls back to a periodic refresh).
 *
 * Desktop: LEFT details & controls · CENTER what needs you + timeline · RIGHT live state.
 * Mobile: one column, sticky controls, details and live state in a bottom sheet.
 */
import {
  ArrowLeftIcon,
  ListTreeIcon,
  PanelRightOpenIcon,
  ScrollTextIcon,
  TerminalSquareIcon,
  WorkflowIcon,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import type { TaskDetailView } from "@/lib/api";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress, Skeleton } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { PageContainer } from "@/components/ui/page";
import { EmptyState, ErrorState, InlineError } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { dateTime, percent } from "@/lib/format";
import type { StreamState } from "@/lib/realtime/sse";
import { useTaskStream } from "@/lib/realtime/use-task-stream";
import { qk } from "@/lib/query/keys";
import { isTaskActive, taskStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { DeveloperPanel } from "./developer-panel";
import { Elapsed } from "./elapsed";
import {
  agentLabel,
  STREAM_END_STATUSES,
  useAgentsIndex,
  usePendingTaskApprovals,
  useTaskActions,
  useTaskDetail,
  useTaskLogs,
  useTaskSummary,
} from "./hooks";
import { InputRequest } from "./input-request";
import { LiveStatePanel } from "./live-state-panel";
import { RecoveryPanel } from "./recovery-panel";
import { StreamIndicator } from "./stream-indicator";
import { TaskControls } from "./task-controls";
import { TaskLogs } from "./task-logs";
import { TaskSummary } from "./task-summary";
import { buildTimeline } from "./timeline/normalize";
import { LiveActivity } from "./timeline/live-activity";
import { StepCard } from "./timeline/step-card";
import { TaskTimeline } from "./timeline/task-timeline";

const RECOVERY_STATES = new Set(["recovering", "requires_reconciliation", "expired", "blocked", "failed"]);
/** Resting states where "what happened so far" is the most useful thing to read. */
const SUMMARY_STATES = new Set([
  "completed",
  "failed",
  "cancelled",
  "expired",
  "blocked",
  "requires_reconciliation",
  "paused",
]);

function DetailSkeleton() {
  return (
    <PageContainer width="wide" aria-busy>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-8 w-3/4" />
      <div className="mt-3 flex gap-2">
        <Skeleton className="h-6 w-24 rounded-full" />
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[260px_minmax(0,1fr)_360px]">
        <Skeleton className="hidden h-72 xl:block" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-7 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="hidden h-96 lg:block" />
      </div>
    </PageContainer>
  );
}

export function TaskDetail({ taskId }: { taskId: string }) {
  const streamStateRef = React.useRef<StreamState>("idle");
  const detail = useTaskDetail(taskId, () => streamStateRef.current);
  const status = detail.data?.status;
  // Connect once the task is known; reconnect when it leaves (or enters) a stream-ending status,
  // e.g. after resuming a failed task — the backend ends the stream for resting tasks.
  const stream = useTaskStream(taskId, {
    enabled: status !== undefined,
    restartKey: status ? STREAM_END_STATUSES.has(status) : null,
  });
  React.useEffect(() => {
    streamStateRef.current = stream.state;
  }, [stream.state]);
  // The backend only ends the stream once the task rests; if our copy still says otherwise, re-read it.
  const queryClient = useQueryClient();
  const staleAfterEnd = stream.state === "ended" && status !== undefined && !STREAM_END_STATUSES.has(status);
  React.useEffect(() => {
    if (!staleAfterEnd) return;
    void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(taskId) });
    void queryClient.invalidateQueries({ queryKey: qk.tasks.summary(taskId) });
    void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
  }, [staleAfterEnd, queryClient, taskId]);
  if (detail.isLoading) return <DetailSkeleton />;
  if (!detail.data) {
    return (
      <PageContainer width="narrow">
        <BackLink />
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} title={undefined} />
      </PageContainer>
    );
  }
  return <TaskDetailLoaded task={detail.data} stream={stream} refetchError={detail.error} />;
}

function BackLink() {
  return (
    <Link
      href="/app/tasks"
      className="inline-flex items-center gap-1.5 rounded text-xs text-fg-muted outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50"
    >
      <ArrowLeftIcon className="size-3.5" aria-hidden /> Tasks
    </Link>
  );
}

function DetailsPanel({
  task,
  agent,
}: {
  task: TaskDetailView;
  agent: { name: string; version: string | null | undefined };
}) {
  const current = task.steps.filter((s) => s.plan_version === task.plan_version);
  const verified = current.filter((s) => s.verification_status === "passed").length;
  const rows: Array<[string, React.ReactNode]> = [
    [
      "Agent",
      <span key="a">
        {agent.name}
        {agent.version && <span className="ml-1 font-mono text-2xs text-fg-subtle">{agent.version}</span>}
      </span>,
    ],
    ["Created", <RelativeTime key="c" value={task.created_at} />],
    [
      "Started",
      task.started_at ? (
        <RelativeTime key="s" value={task.started_at} />
      ) : (
        <span key="s" className="text-fg-subtle">
          Not yet
        </span>
      ),
    ],
    [task.completed_at ? "Finished" : "Updated", <RelativeTime key="u" value={task.completed_at ?? task.updated_at} />],
    ["Elapsed", <Elapsed key="e" task={task} />],
    [
      "Plan",
      task.plan_version > 0
        ? `v${task.plan_version} · ${current.length} step${current.length === 1 ? "" : "s"}`
        : "Not planned yet",
    ],
    ["Verified", current.length ? `${verified} of ${current.length}` : "—"],
    [
      "Priority",
      task.priority === 100 ? "Normal" : task.priority < 100 ? `Higher (${task.priority})` : `Lower (${task.priority})`,
    ],
    [
      "Activity",
      `${task.tool_calls} tool call${task.tool_calls === 1 ? "" : "s"} · ${task.model_calls} model call${task.model_calls === 1 ? "" : "s"}`,
    ],
  ];
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-fg-subtle">{k}</dt>
          <dd className="min-w-0 text-fg">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

function TaskDetailLoaded({
  task,
  stream,
  refetchError,
}: {
  task: TaskDetailView;
  stream: ReturnType<typeof useTaskStream>;
  refetchError: unknown;
}) {
  const developerMode = useUiStore((s) => s.developerMode);
  const actions = useTaskActions(task.task_id);
  const agents = useAgentsIndex();
  const approvals = usePendingTaskApprovals(task.task_id);
  const live = isTaskActive(task.status);
  const summaryEnabled = SUMMARY_STATES.has(task.status);
  const summary = useTaskSummary(task.task_id);
  const [centerTab, setCenterTab] = React.useState("timeline");
  const logs = useTaskLogs(task.task_id, centerTab === "logs");
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [highlightStep, setHighlightStep] = React.useState<string | null>(null);
  const [showAllEvents, setShowAllEvents] = React.useState(false);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const meta = taskStatusMeta[task.status];
  const agent = agentLabel(task, agents.index, task.reproducibility.agent);
  const currentSteps = React.useMemo(
    () => task.steps.filter((s) => s.plan_version === task.plan_version),
    [task.steps, task.plan_version],
  );
  const olderSteps = React.useMemo(
    () => task.steps.filter((s) => s.plan_version !== task.plan_version),
    [task.steps, task.plan_version],
  );
  const timeline = React.useMemo(
    () => buildTimeline(stream.events, { steps: task.steps, taskStatus: task.status }),
    [stream.events, task.steps, task.status],
  );
  const pendingApprovals = approvals.data?.items ?? [];
  const latestVerification = React.useCallback(
    (stepId: string) => {
      const list = task.verifications.filter((v) => v.step_id === stepId);
      return list.length ? list[list.length - 1] : null;
    },
    [task.verifications],
  );

  React.useEffect(() => {
    const previous = document.title;
    document.title = `${task.goal.slice(0, 60)}${task.goal.length > 60 ? "…" : ""} · AgentOS`;
    return () => {
      document.title = previous;
    };
  }, [task.goal]);

  const focusInput = () => {
    setDrawerOpen(false);
    requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      inputRef.current?.focus({ preventScroll: true });
    });
  };
  const focusConfirm = () => {
    setDrawerOpen(false);
    requestAnimationFrame(() =>
      document.getElementById("confirm-outcome")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };
  const selectStep = (stepId: string) => {
    setDrawerOpen(false);
    setCenterTab("steps");
    setHighlightStep(stepId);
    requestAnimationFrame(() =>
      document.getElementById(`step-${stepId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
    );
  };

  const controls = (
    <TaskControls
      task={task}
      actions={actions}
      onProvideInput={focusInput}
      onConfirmOutcome={focusConfirm}
      layout="stack"
    />
  );
  const progressPct = Math.round(task.progress * 100);

  return (
    <PageContainer width="wide" className="pb-32 lg:pb-8">
      <BackLink />

      {/* Header */}
      <header className="mt-3 flex flex-col gap-3 border-b border-line pb-5">
        <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance-safe text-fg sm:text-2xl">
          {task.goal}
        </h1>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-muted">
          <StatusBadge kind="task" value={task.status} size="md" />
          <div className="flex items-center gap-2">
            <Progress
              value={progressPct}
              tone={meta.tone === "neutral" ? "accent" : meta.tone}
              className="w-24 sm:w-32"
              label="Task progress"
            />
            <span className="text-fg tabular-nums">{percent(task.progress)}</span>
          </div>
          <span className="flex items-center gap-1">
            <span className="text-fg-subtle">Elapsed</span> <Elapsed task={task} className="text-fg" />
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <span className="text-fg-subtle">Agent</span>
            <span className="text-fg">{agent.name}</span>
            {agent.version && <span className="font-mono text-2xs text-fg-subtle">{agent.version}</span>}
          </span>
          <StreamIndicator state={stream.state} />
        </div>
        <p className="text-[13px] text-fg-muted" aria-live="polite">
          <span className="sr-only">Task status: {meta.label}. </span>
          {meta.description}
          {task.completed_at && <span className="text-fg-subtle"> · {dateTime(task.completed_at)}</span>}
        </p>
        {refetchError ? <InlineError error={refetchError} className="max-w-xl" /> : null}
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[250px_minmax(0,1fr)_360px]">
        {/* LEFT: details & controls (xl) */}
        <aside className="hidden xl:block" aria-label="Task details">
          <div className="sticky top-20 flex flex-col gap-5">
            <DetailsPanel task={task} agent={agent} />
            <div className="border-t border-line pt-4">{controls}</div>
          </div>
        </aside>

        {/* CENTER */}
        <div className="flex min-w-0 flex-col gap-5">
          {(live || task.status === "waiting_approval" || task.status === "waiting_input") && (
            <LiveActivity current={timeline.current} status={task.status} last={timeline.entries.at(-1)} />
          )}

          {pendingApprovals.length > 0 && (
            <section aria-label="Approvals needed" className="flex flex-col gap-3">
              {pendingApprovals.map((a) => (
                <ApprovalCard key={a.id} approval={a} compact={pendingApprovals.length > 1} />
              ))}
            </section>
          )}

          {task.status === "waiting_input" && (
            <InputRequest ref={inputRef} questions={task.pending_questions ?? []} actions={actions} />
          )}

          {RECOVERY_STATES.has(task.status) && (
            <RecoveryPanel task={task} actions={actions} entries={timeline.entries} />
          )}

          {(summaryEnabled || summary.data?.direct_response) && (
            <TaskSummary
              task={task}
              summary={summary.data}
              isLoading={summary.isLoading}
              error={summary.error}
              onRetry={() => void summary.refetch()}
              developerMode={developerMode}
            />
          )}

          <Tabs value={centerTab} onValueChange={setCenterTab}>
            <div className="flex flex-wrap items-center gap-2">
              <TabsList aria-label="Task views">
                <TabsTrigger value="timeline">
                  <WorkflowIcon /> Timeline
                </TabsTrigger>
                <TabsTrigger value="steps">
                  <ListTreeIcon /> Steps{currentSteps.length ? ` (${currentSteps.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="logs">
                  <ScrollTextIcon /> Logs
                </TabsTrigger>
                {developerMode && (
                  <TabsTrigger value="developer">
                    <TerminalSquareIcon /> Developer
                  </TabsTrigger>
                )}
              </TabsList>
              {developerMode && centerTab === "timeline" && (
                <label className="ml-auto flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={showAllEvents}
                    onChange={(e) => setShowAllEvents(e.target.checked)}
                    className="accent-[var(--color-accent)]"
                  />
                  Show every event
                </label>
              )}
            </div>

            <TabsContent value="timeline">
              {stream.error && stream.events.length === 0 ? (
                <ErrorState error={stream.error} compact title="Couldn't load the task history" />
              ) : stream.isLoading ? (
                <div className="flex flex-col gap-4" aria-busy>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex gap-3">
                      <Skeleton className="size-7 rounded-full" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-3 w-1/3" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <TaskTimeline
                  events={stream.events}
                  steps={task.steps}
                  taskStatus={task.status}
                  developerMode={developerMode}
                  showAllEvents={showAllEvents}
                  empty={
                    <EmptyState
                      size="sm"
                      title="Waiting for the first event"
                      description="AgentOS received the goal; activity appears here the moment it starts."
                    />
                  }
                />
              )}
            </TabsContent>

            <TabsContent value="steps">
              {currentSteps.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<ListTreeIcon />}
                  title={task.plan_version === 0 ? "No plan yet" : "No actions needed"}
                  description={
                    task.plan_version === 0
                      ? "Steps appear once AgentOS has planned and validated the task."
                      : "This task was answered directly, without taking any action."
                  }
                />
              ) : (
                <div className="flex flex-col gap-3">
                  {currentSteps.map((s) => (
                    <div key={s.id} id={`step-${s.id}`} className="scroll-mt-24">
                      <StepCard
                        step={s}
                        verification={latestVerification(s.id)}
                        total={currentSteps.length}
                        developerMode={developerMode}
                        highlighted={highlightStep === s.id || stepStatusNeedsAttention(s.status)}
                      />
                    </div>
                  ))}
                  {olderSteps.length > 0 && (
                    <details className="rounded-xl border border-line bg-surface-1/50 p-3 text-[13px] text-fg-muted">
                      <summary className="cursor-pointer select-none">
                        Earlier plan versions ({olderSteps.length} superseded steps)
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        {olderSteps.map((s) => (
                          <StepCard
                            key={s.id}
                            step={s}
                            verification={latestVerification(s.id)}
                            developerMode={developerMode}
                            className="opacity-80"
                          />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="logs">
              <TaskLogs
                logs={logs.data}
                steps={task.steps}
                isLoading={logs.isLoading}
                error={logs.error}
                onRetry={() => void logs.refetch()}
              />
            </TabsContent>

            {developerMode && (
              <TabsContent value="developer">
                <DeveloperPanel
                  task={task}
                  lastSeq={stream.lastSeq}
                  eventCount={stream.events.length}
                  streamState={stream.state}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>

        {/* RIGHT: live state (lg+) */}
        <aside className="hidden lg:block" aria-label="Live state">
          <div className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col gap-5 overflow-y-auto pr-1 pb-4">
            <div className="flex flex-col gap-4 rounded-xl border border-line bg-surface-1 p-4 xl:hidden">
              <DetailsPanel task={task} agent={agent} />
              <div className="border-t border-line pt-4">{controls}</div>
            </div>
            <LiveStatePanel task={task} entries={timeline.entries} onSelectStep={selectStep} />
          </div>
        </aside>
      </div>

      {/* Mobile: sticky controls + details sheet */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/90 px-4 py-3 backdrop-blur-md lg:hidden">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <MobilePrimaryControls
              task={task}
              actions={actions}
              onProvideInput={focusInput}
              onConfirmOutcome={focusConfirm}
            />
          </div>
          <Button variant="secondary" size="sm" onClick={() => setDrawerOpen(true)} aria-haspopup="dialog">
            <PanelRightOpenIcon /> Details
          </Button>
        </div>
      </div>
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="lg:hidden">
          <div className="overflow-y-auto px-4 pt-2 pb-8">
            <DrawerTitle className="text-base font-semibold text-fg">Task details</DrawerTitle>
            <DrawerDescription className="mt-0.5 text-xs text-fg-muted">{meta.description}</DrawerDescription>
            <div className="mt-4 flex flex-col gap-5">
              <DetailsPanel task={task} agent={agent} />
              <div className="border-t border-line pt-4">{controls}</div>
              <LiveStatePanel task={task} entries={timeline.entries} onSelectStep={selectStep} />
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </PageContainer>
  );
}

function stepStatusNeedsAttention(status: string): boolean {
  return (
    status === "waiting_approval" ||
    status === "waiting_input" ||
    status === "requires_reconciliation" ||
    status === "blocked"
  );
}

/** The one or two most relevant controls for the sticky mobile bar. */
function MobilePrimaryControls(props: React.ComponentProps<typeof TaskControls>) {
  return <TaskControls {...props} layout="row" className={cn("[&_button]:h-8")} />;
}
