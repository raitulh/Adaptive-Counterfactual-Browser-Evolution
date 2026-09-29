"use client";

/**
 * Task controls offered only when the backend accepts them in the current status
 * (`taskControls`, mirroring app/tasks/service.py). Each has its own pending and error state;
 * cancelling is confirmed and says what has already happened (and will not be undone).
 */
import { CircleCheckIcon, MessageSquareTextIcon, PauseIcon, PlayIcon, SquareIcon } from "lucide-react";
import * as React from "react";
import type { TaskDetailView } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { InlineError } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { Tooltip } from "@/components/ui/tooltip";
import { usePermissions } from "@/lib/auth/hooks";
import { taskControls } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TaskActions } from "./hooks";
import { readable } from "./timeline/readable";

export interface TaskControlsProps {
  task: TaskDetailView;
  actions: TaskActions;
  /** Focus the input form (waiting_input). */
  onProvideInput?: () => void;
  /** Focus the confirmation panel (requires_reconciliation). */
  onConfirmOutcome?: () => void;
  layout?: "stack" | "row";
  className?: string;
}

export function TaskControls({
  task,
  actions,
  onProvideInput,
  onConfirmOutcome,
  layout = "row",
  className,
}: TaskControlsProps) {
  const { can, isLoading } = usePermissions();
  const [confirmCancel, setConfirmCancel] = React.useState(false);
  const [lastError, setLastError] = React.useState<unknown>(null);
  const c = taskControls(task.status, task.plan_version);
  const current = task.steps.filter((s) => s.plan_version === task.plan_version);
  const done = current.filter((s) => s.status === "completed" && s.permission_level !== "read");

  if (!isLoading && !can("tasks:cancel")) {
    return (
      <p className={cn("text-xs text-fg-subtle", className)}>
        You can follow this task but your role can&apos;t control it.
      </p>
    );
  }
  const any = c.cancel || c.pause || c.resume || c.provideInput || c.confirmOutcome;
  if (!any) return null;

  const run = (m: TaskActions["pause"] | TaskActions["resume"], success: (status: string) => string) => {
    setLastError(null);
    m.mutate(undefined, {
      onSuccess: (t) => toast.success(success(t.status)),
      onError: (err) => setLastError(err),
    });
  };

  const stack = layout === "stack";
  const btn = stack ? "w-full justify-start" : "";

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("flex gap-2", stack ? "flex-col" : "flex-wrap items-center")}>
        {c.provideInput && onProvideInput && (
          <Button variant="primary" size="sm" className={btn} onClick={onProvideInput}>
            <MessageSquareTextIcon /> Provide input
          </Button>
        )}
        {c.confirmOutcome && onConfirmOutcome && (
          <Button variant="primary" size="sm" className={btn} onClick={onConfirmOutcome}>
            <CircleCheckIcon /> Confirm outcome
          </Button>
        )}
        {c.resume && (
          <Button
            variant={c.confirmOutcome ? "secondary" : "primary"}
            size="sm"
            className={btn}
            loading={actions.resume.isPending}
            onClick={() => run(actions.resume, () => "Resumed — AgentOS is picking up where it left off.")}
          >
            <PlayIcon /> Resume
          </Button>
        )}
        {c.pause && (
          <Tooltip content="Pauses at the next safe point — an action in flight finishes first.">
            <Button
              variant="secondary"
              size="sm"
              className={btn}
              loading={actions.pause.isPending}
              onClick={() =>
                run(actions.pause, (s) => (s === "paused" ? "Paused." : "Pausing at the next safe point."))
              }
            >
              <PauseIcon /> Pause
            </Button>
          </Tooltip>
        )}
        {c.cancel && (
          <Button
            variant="danger-outline"
            size="sm"
            className={btn}
            loading={actions.cancel.isPending}
            onClick={() => setConfirmCancel(true)}
          >
            <SquareIcon /> Cancel task
          </Button>
        )}
      </div>
      {lastError ? <InlineError error={lastError} /> : null}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={(o) => !actions.cancel.isPending && setConfirmCancel(o)}
        tone="danger"
        title="Cancel this task?"
        description="AgentOS stops at the next safe point and won't start anything new. Pending approvals are withdrawn."
        confirmLabel="Cancel task"
        cancelLabel="Keep running"
        loading={actions.cancel.isPending}
        onConfirm={() =>
          new Promise<void>((resolve) => {
            setLastError(null);
            actions.cancel.mutate(undefined, {
              onSuccess: (t) => {
                toast.success(t.status === "cancelled" ? "Task cancelled." : "Cancelling at the next safe point.");
                setConfirmCancel(false);
                resolve();
              },
              onError: (err) => {
                setLastError(err);
                setConfirmCancel(false);
                resolve();
              },
            });
          })
        }
      >
        {done.length > 0 ? (
          <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5 text-[13px]">
            <p className="font-medium text-fg">Already done — cancelling does not undo these:</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-fg-muted">
              {done.map((s) => (
                <li key={s.id}>{readable(s.output_summary) ?? s.action}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[13px] text-fg-muted">Nothing has changed in any external system yet.</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
