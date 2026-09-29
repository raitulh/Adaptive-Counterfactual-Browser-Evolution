"use client";

/**
 * Live task timeline.
 *
 *  1. Durable events are loaded over REST (`GET /tasks/{id}/events`, all pages).
 *  2. The SSE stream resumes after the last known seq (`Last-Event-ID`) and appends new events.
 *  3. Duplicates are dropped by seq; a gap triggers a REST catch-up; every reconnect re-reads
 *     durable state (events + task detail). The task detail/summary queries are invalidated
 *     (throttled) on every event, so the UI always renders backend state — never inferred state.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { tasksApi, type TaskEvent } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { isContiguous, maxSeq, mergeEvents, parseTaskEvent } from "./events";
import { markTaskStreamActive } from "./registry";
import { SseConnection, type StreamState } from "./sse";

const APPROVAL_EVENTS = new Set(["APPROVAL_REQUIRED", "APPROVAL_GRANTED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED"]);
const LIST_EVENTS = new Set(["TASK_STATE_CHANGED", "TASK_COMPLETED", "TASK_FAILED", "TASK_CANCELLED", "TASK_PAUSED", "TASK_RESUMED"]);

export interface TaskStreamResult {
  events: TaskEvent[];
  state: StreamState;
  isLoading: boolean;
  error: unknown;
  lastSeq: number;
}

export interface TaskStreamOptions {
  enabled?: boolean;
  /**
   * Reconnect whenever this value changes. The backend ends a task's stream once the task rests in
   * failed/expired/completed/cancelled; a resumed task needs a new connection (it resumes from the
   * last seen seq via Last-Event-ID, so nothing is missed). Callers pass e.g. whether the task is
   * currently in a stream-ending status.
   */
  restartKey?: string | number | boolean | null;
}

export function useTaskStream(taskId: string | null, { enabled = true, restartKey = null }: TaskStreamOptions = {}): TaskStreamResult {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>("idle");
  const key = qk.tasks.events(taskId ?? "none");

  const eventsQuery = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => tasksApi.eventsAfter(taskId!, 0, { signal }),
    enabled: Boolean(taskId),
    staleTime: Infinity, // kept fresh by the stream + explicit reconciliation
  });

  const loaded = eventsQuery.isSuccess;
  const invalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!taskId || !enabled || !loaded) return;
    const eventsKey = qk.tasks.events(taskId);
    const current = () => queryClient.getQueryData<TaskEvent[]>(eventsKey) ?? [];
    let pendingKinds = new Set<string>();

    const flushInvalidations = () => {
      invalidateTimer.current = null;
      const kinds = pendingKinds;
      pendingKinds = new Set();
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(taskId) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.summary(taskId) });
      if ([...kinds].some((k) => APPROVAL_EVENTS.has(k))) void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
      if ([...kinds].some((k) => LIST_EVENTS.has(k))) void queryClient.invalidateQueries({ queryKey: qk.tasks.lists });
    };
    const scheduleInvalidate = (kind: string) => {
      pendingKinds.add(kind);
      if (!invalidateTimer.current) invalidateTimer.current = setTimeout(flushInvalidations, 250);
    };

    const catchUp = async () => {
      const since = isContiguous(current()) ? maxSeq(current()) : 0;
      const missing = await tasksApi.eventsAfter(taskId, since).catch(() => []);
      queryClient.setQueryData<TaskEvent[]>(eventsKey, (prev) => mergeEvents(prev ?? [], missing));
    };

    const connection = new SseConnection({
      path: `/tasks/${taskId}/events/stream`,
      lastEventId: () => {
        const events = current();
        return events.length && isContiguous(events) ? String(maxSeq(events)) : null;
      },
      onEvent: (evt) => {
        if (evt.event === "end") {
          scheduleInvalidate("end");
          return;
        }
        const event = parseTaskEvent(evt.event, evt.data);
        if (!event) return;
        const before = current();
        if (event.seq > maxSeq(before) + 1) void catchUp(); // gap: fetch what we missed
        queryClient.setQueryData<TaskEvent[]>(eventsKey, (prev) => mergeEvents(prev ?? [], [event]));
        scheduleInvalidate(event.event_type);
      },
      onReconnected: () => {
        void catchUp();
        scheduleInvalidate("reconnected");
      },
      onStateChange: (s) => setState(s),
    });

    const release = markTaskStreamActive(taskId);
    connection.start();
    return () => {
      release();
      connection.stop();
      if (invalidateTimer.current) clearTimeout(invalidateTimer.current);
      invalidateTimer.current = null;
    };
  }, [taskId, enabled, loaded, queryClient, restartKey]);

  const events = eventsQuery.data ?? [];
  return {
    events,
    state: taskId && enabled ? state : "idle",
    isLoading: eventsQuery.isLoading,
    error: eventsQuery.error,
    lastSeq: maxSeq(events),
  };
}
