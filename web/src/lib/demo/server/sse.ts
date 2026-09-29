/**
 * Simulated Server-Sent Events, framed exactly like the backend (`app/tasks/router.py`):
 *   ": connected" → `id: <seq>` / `event: <EVENT_TYPE>` / `data: <json>` frames → ": keep-alive"
 * comments while idle → `event: end` once the task is final (completed/cancelled/failed/expired).
 *
 * Durable events live in the store; the bus only wakes streams up (like Redis pub/sub in front of
 * PostgreSQL). Streams close on `end`, when the request's signal aborts, or when the reader cancels.
 */
import type { UserStreamMessage } from "@/lib/api";
import { timeScale } from "./clock";

const encoder = new TextEncoder();
const KEEPALIVE_MS = 15_000;

/** Task statuses after which the task stream ends (the backend's `_STREAM_END_VALUES`). */
export const STREAM_END_STATUSES = new Set(["completed", "cancelled", "failed", "expired"]);

export function sseFrame(event: string, data: unknown, id?: number): string {
  const lines: string[] = [];
  if (id !== undefined) lines.push(`id: ${id}`);
  lines.push(`event: ${event}`);
  lines.push(`data: ${JSON.stringify(data)}`);
  return `${lines.join("\n")}\n\n`;
}

type Wake = () => void;

/** In-process pub/sub. Deliveries are asynchronous (microtasks) so a "transaction" of appends is
 *  always fully visible before any stream reads it. */
export class EventBus {
  private taskListeners = new Map<string, Set<Wake>>();
  private userListeners = new Map<string, Set<(m: UserStreamMessage) => void>>();
  private pendingWakes = new Set<Wake>();

  subscribeTask(taskId: string, wake: Wake): () => void {
    const set = this.taskListeners.get(taskId) ?? new Set();
    set.add(wake);
    this.taskListeners.set(taskId, set);
    return () => {
      set.delete(wake);
      this.pendingWakes.delete(wake);
    };
  }

  publishTask(taskId: string): void {
    for (const wake of this.taskListeners.get(taskId) ?? []) {
      if (this.pendingWakes.has(wake)) continue;
      this.pendingWakes.add(wake);
      queueMicrotask(() => {
        if (!this.pendingWakes.delete(wake)) return;
        wake();
      });
    }
  }

  subscribeUser(userId: string, fn: (m: UserStreamMessage) => void): () => void {
    const set = this.userListeners.get(userId) ?? new Set();
    set.add(fn);
    this.userListeners.set(userId, set);
    return () => set.delete(fn);
  }

  publishUser(userId: string, message: UserStreamMessage): void {
    for (const fn of this.userListeners.get(userId) ?? []) queueMicrotask(() => fn(message));
  }

  get listenerCount(): number {
    let n = 0;
    for (const s of this.taskListeners.values()) n += s.size;
    for (const s of this.userListeners.values()) n += s.size;
    return n;
  }
}

interface StreamControl {
  send(text: string): void;
  close(): void;
  onCleanup(fn: () => void): void;
}

function sseStream(signal: AbortSignal | null, setup: (c: StreamControl) => void): ReadableStream<Uint8Array> {
  let closed = false;
  const cleanups: (() => void)[] = [];
  const cleanup = () => {
    closed = true;
    while (cleanups.length) cleanups.pop()!();
  };
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const control: StreamControl = {
        send(text) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            cleanup();
          }
        },
        close() {
          if (closed) return;
          cleanup();
          try {
            controller.close();
          } catch {
            /* reader already gone */
          }
        },
        onCleanup(fn) {
          cleanups.push(fn);
        },
      };
      if (signal?.aborted) {
        control.close();
        return;
      }
      const onAbort = () => control.close();
      signal?.addEventListener("abort", onAbort, { once: true });
      control.onCleanup(() => signal?.removeEventListener("abort", onAbort));
      let timer: ReturnType<typeof setTimeout> | null = null;
      const every = Math.max(20, KEEPALIVE_MS * timeScale());
      const tick = () => {
        control.send(": keep-alive\n\n");
        timer = setTimeout(tick, every);
      };
      timer = setTimeout(tick, every);
      control.onCleanup(() => {
        if (timer) clearTimeout(timer);
      });
      control.send(": connected\n\n");
      setup(control);
    },
    cancel() {
      cleanup();
    },
  });
}

export interface StreamableEvent {
  seq: number;
  event_type: string;
  step_id: string | null;
  actor_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export function taskEventStream(opts: {
  bus: EventBus;
  taskId: string;
  afterSeq: number;
  signal: AbortSignal | null;
  read: () => { status: string; events: readonly StreamableEvent[] } | null;
}): ReadableStream<Uint8Array> {
  return sseStream(opts.signal, (c) => {
    let last = opts.afterSeq;
    const pump = () => {
      const state = opts.read();
      if (!state) return c.close();
      for (const row of state.events) {
        if (row.seq <= last) continue;
        last = row.seq;
        // Same fields as TaskEventOut (plus task_id), so clients merge SSE and REST events uniformly.
        c.send(sseFrame(row.event_type, { ...row, task_id: opts.taskId }, row.seq));
      }
      if (STREAM_END_STATUSES.has(state.status)) {
        c.send(sseFrame("end", { task_id: opts.taskId, status: state.status }));
        c.close();
      }
    };
    c.onCleanup(opts.bus.subscribeTask(opts.taskId, pump));
    pump();
  });
}

export function userEventStream(opts: {
  bus: EventBus;
  userId: string;
  signal: AbortSignal | null;
}): ReadableStream<Uint8Array> {
  return sseStream(opts.signal, (c) => {
    c.onCleanup(opts.bus.subscribeUser(opts.userId, (message) => c.send(sseFrame(message.type, message))));
  });
}
