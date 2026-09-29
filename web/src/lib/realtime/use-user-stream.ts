"use client";

/**
 * User-wide live updates (`GET /events/stream`): task activity, approvals and notifications for the
 * signed-in user. It only *invalidates* queries — REST remains the source of truth — and it is a
 * best-effort channel (no replay), so every reconnect refreshes the affected lists.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";
import type { UserStreamMessage } from "@/lib/api";
import { qk } from "@/lib/query/keys";
import { isTaskStreamActive } from "./registry";
import { SseConnection, type StreamState } from "./sse";

interface RealtimeState {
  userStream: StreamState;
  setUserStream: (s: StreamState) => void;
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  userStream: "idle",
  setUserStream: (userStream) => set({ userStream }),
}));

export type UserStreamListener = (message: UserStreamMessage) => void;
const listeners = new Set<UserStreamListener>();

/** Subscribe to raw user-stream messages (e.g. to show a toast). Returns an unsubscribe function. */
export function onUserStreamMessage(listener: UserStreamListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const APPROVAL_EVENTS = new Set(["APPROVAL_REQUIRED", "APPROVAL_GRANTED", "APPROVAL_REJECTED", "APPROVAL_EXPIRED"]);

export function useUserStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  const setState = useRealtimeStore((s) => s.setUserStream);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pending = new Set<string>();
    const flush = () => {
      timer = null;
      for (const key of pending) {
        if (key === "tasks") void queryClient.invalidateQueries({ queryKey: qk.tasks.lists });
        else if (key === "approvals") void queryClient.invalidateQueries({ queryKey: qk.approvals.all });
        else if (key === "notifications") void queryClient.invalidateQueries({ queryKey: qk.notifications.all });
        else if (key.startsWith("task:")) {
          const id = key.slice(5);
          void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(id) });
          void queryClient.invalidateQueries({ queryKey: qk.tasks.summary(id) });
        }
      }
      pending.clear();
    };
    const schedule = (...keys: string[]) => {
      keys.forEach((k) => pending.add(k));
      if (!timer) timer = setTimeout(flush, 300);
    };

    const connection = new SseConnection({
      path: "/events/stream",
      onEvent: (evt) => {
        if (evt.event === "stream_unavailable") return; // server asks us to reconnect later
        let message: UserStreamMessage;
        try {
          message = JSON.parse(evt.data) as UserStreamMessage;
        } catch {
          return;
        }
        if (message.type === "NOTIFICATION_CREATED") {
          schedule("notifications");
        } else if ("task_id" in message) {
          schedule("tasks");
          if (!isTaskStreamActive(message.task_id)) schedule(`task:${message.task_id}`);
          if (APPROVAL_EVENTS.has(message.event_type)) schedule("approvals");
        }
        for (const l of listeners) l(message);
      },
      onReconnected: () => schedule("tasks", "approvals", "notifications"),
      onStateChange: (s) => setState(s),
    });
    connection.start();
    return () => {
      connection.stop();
      if (timer) clearTimeout(timer);
      setState("idle");
    };
  }, [enabled, queryClient, setState]);
}
