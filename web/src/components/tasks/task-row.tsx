"use client";

/** A task in a list: goal, status (with live dot), progress, agent and timing. Links to the task. */
import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import type { AgentOut, TaskOut } from "@/lib/api";
import { StatusBadge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/controls";
import { RelativeTime } from "@/components/ui/data-display";
import { isTaskActive, taskStatusMeta } from "@/lib/status";
import { cn } from "@/lib/utils";

export function taskAgentName(task: Pick<TaskOut, "agent_id">, agents?: Map<string, AgentOut>): string {
  if (!task.agent_id) return "Built-in agent";
  return agents?.get(task.agent_id)?.name ?? "Custom agent";
}

export function TaskRow({
  task,
  agents,
  className,
}: {
  task: TaskOut;
  agents?: Map<string, AgentOut>;
  className?: string;
}) {
  const meta = taskStatusMeta[task.status];
  const live = isTaskActive(task.status);
  const pct = Math.round(task.progress * 100);
  return (
    <Link
      href={`/app/tasks/${task.task_id}`}
      className={cn(
        "group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors outline-none hover:bg-white/[0.025] focus-visible:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset md:grid-cols-[minmax(0,1fr)_9.5rem_7rem_8rem_1rem]",
        className,
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-fg">{task.goal}</p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-xs text-fg-subtle">
          <span className="truncate">{taskAgentName(task, agents)}</span>
          <span aria-hidden>·</span>
          <span>
            created <RelativeTime value={task.created_at} />
          </span>
          {task.failure_message && (meta.tone === "danger" || task.status === "blocked") && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate text-danger/80">{task.failure_message}</span>
            </>
          )}
        </p>
      </div>
      <div className="justify-self-end md:justify-self-start">
        <StatusBadge kind="task" value={task.status} />
      </div>
      <div className="col-span-2 flex items-center gap-2 md:col-span-1" aria-label={`Progress ${pct}%`}>
        <Progress
          value={pct}
          tone={meta.tone === "neutral" ? "accent" : meta.tone}
          className={cn("h-1", !live && task.status !== "completed" && "opacity-60")}
        />
        <span className="w-8 text-right font-mono text-2xs text-fg-subtle tabular-nums">{pct}%</span>
      </div>
      <div className="hidden text-xs text-fg-muted md:block">
        updated <RelativeTime value={task.updated_at} />
      </div>
      <ChevronRightIcon
        className="hidden size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg md:block"
        aria-hidden
      />
    </Link>
  );
}
