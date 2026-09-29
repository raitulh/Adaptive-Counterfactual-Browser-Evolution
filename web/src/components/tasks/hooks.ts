"use client";

/**
 * Task data hooks. REST is the source of truth; the task stream (useTaskStream) invalidates these
 * queries on every event, and a slow refetch covers a degraded stream.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { agentsApi, approvalsApi, tasksApi, type AgentOut, type StepConfirmation, type TaskDetailView, type TaskOut } from "@/lib/api";
import { usePermissions } from "@/lib/auth/hooks";
import { qk } from "@/lib/query/keys";
import type { StreamState } from "@/lib/realtime/sse";
import { isTaskActive } from "@/lib/status";

export function useTaskDetail(taskId: string, streamState?: StreamState) {
  return useQuery({
    queryKey: qk.tasks.detail(taskId),
    queryFn: ({ signal }) => tasksApi.get(taskId, { signal }),
    // Safety net only: the stream keeps it fresh. Poll faster when the stream is not connected.
    refetchInterval: (query) => {
      const task = query.state.data;
      if (!task || !isTaskActive(task.status)) return false;
      return streamState === "open" ? 30_000 : 5_000;
    },
  });
}

export function useTaskSummary(taskId: string, enabled = true) {
  return useQuery({
    queryKey: qk.tasks.summary(taskId),
    queryFn: ({ signal }) => tasksApi.summary(taskId, { signal }),
    enabled,
  });
}

export function useTaskLogs(taskId: string, enabled = true) {
  return useQuery({
    queryKey: qk.tasks.logs(taskId),
    queryFn: ({ signal }) => tasksApi.logs(taskId, { limit: 500 }, { signal }),
    enabled,
    staleTime: 5_000,
  });
}

export function usePendingTaskApprovals(taskId: string) {
  const query = { task_id: taskId, status: "pending", limit: 50 } as const;
  return useQuery({
    queryKey: qk.approvals.list(query),
    queryFn: ({ signal }) => approvalsApi.list(query, { signal }),
    staleTime: 10_000,
  });
}

/** Agents by id (for names). Only fetched when the user can read agents. */
export function useAgentsIndex() {
  const { can } = usePermissions();
  const query = useQuery({
    queryKey: qk.agents.list,
    queryFn: ({ signal }) => agentsApi.list({ limit: 100 }, { signal }),
    enabled: can("agents:read"),
    staleTime: 60_000,
  });
  const index = React.useMemo(() => new Map<string, AgentOut>((query.data?.items ?? []).map((a) => [a.id, a])), [query.data]);
  return { ...query, index };
}

/** "builtin-default:v1" → { name: "Built-in agent", version: "v1" } */
export function agentLabel(task: Pick<TaskOut, "agent_id">, index: Map<string, AgentOut>, reproducibilityAgent?: unknown) {
  const label = typeof reproducibilityAgent === "string" ? reproducibilityAgent : null;
  const version = label?.includes(":") ? label.split(":").pop() : null;
  if (task.agent_id) {
    const agent = index.get(task.agent_id);
    return { name: agent?.name ?? "Custom agent", version: version ?? (agent?.current_version ? `v${agent.current_version.version_number}` : null) };
  }
  return { name: "Built-in agent", version };
}

function useInvalidateTask(taskId: string) {
  const queryClient = useQueryClient();
  return React.useCallback(
    (task?: TaskOut) => {
      if (task) {
        queryClient.setQueryData<TaskDetailView>(qk.tasks.detail(taskId), (prev) => (prev ? { ...prev, ...task } : prev));
      }
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.summary(taskId) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.events(taskId) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.lists });
      void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
    },
    [queryClient, taskId],
  );
}

/** Cancel / pause / resume / provide input / confirm outcome — each with its own pending/error state. */
export function useTaskActions(taskId: string) {
  const refresh = useInvalidateTask(taskId);
  const cancel = useMutation({ mutationFn: () => tasksApi.cancel(taskId), onSuccess: refresh });
  const pause = useMutation({ mutationFn: () => tasksApi.pause(taskId), onSuccess: refresh });
  const resume = useMutation({ mutationFn: () => tasksApi.resume(taskId), onSuccess: refresh });
  const provideInput = useMutation({ mutationFn: (answer: string) => tasksApi.provideInput(taskId, { answer }), onSuccess: refresh });
  const confirmStep = useMutation({
    mutationFn: ({ stepId, body }: { stepId: string; body: StepConfirmation }) => tasksApi.confirmStep(taskId, stepId, body),
    onSuccess: refresh,
  });
  return { cancel, pause, resume, provideInput, confirmStep };
}

export type TaskActions = ReturnType<typeof useTaskActions>;

/** A clock that ticks while `enabled` (for live elapsed time and countdowns). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return now;
}
