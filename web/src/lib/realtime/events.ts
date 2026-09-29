import type { TaskEvent } from "@/lib/api";

/**
 * Merge task events by sequence number: sorted, gap-aware, duplicate-free.
 * PostgreSQL `task_events` is the source of truth; SSE only delivers them sooner.
 */
export function mergeEvents(existing: readonly TaskEvent[], incoming: readonly TaskEvent[]): TaskEvent[] {
  if (incoming.length === 0) return existing as TaskEvent[];
  const bySeq = new Map<number, TaskEvent>();
  for (const e of existing) bySeq.set(e.seq, e);
  let changed = false;
  for (const e of incoming) {
    if (!bySeq.has(e.seq)) {
      bySeq.set(e.seq, e);
      changed = true;
    }
  }
  if (!changed) return existing as TaskEvent[];
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

export function maxSeq(events: readonly TaskEvent[]): number {
  return events.length ? events[events.length - 1].seq : 0;
}

/** True when `events` (sorted) has no holes starting from seq 1. */
export function isContiguous(events: readonly TaskEvent[]): boolean {
  for (let i = 0; i < events.length; i++) if (events[i].seq !== i + 1) return false;
  return true;
}

/** Parse an SSE `data:` payload of the task stream into a TaskEvent (null if malformed). */
export function parseTaskEvent(eventName: string, data: string): TaskEvent | null {
  try {
    const raw = JSON.parse(data) as Partial<TaskEvent> & { seq?: number };
    if (typeof raw.seq !== "number") return null;
    return {
      seq: raw.seq,
      event_type: (raw.event_type ?? eventName) as TaskEvent["event_type"],
      step_id: raw.step_id ?? null,
      actor_type: raw.actor_type ?? "system",
      payload: (raw.payload as TaskEvent["payload"]) ?? {},
      created_at: raw.created_at ?? new Date().toISOString(),
      task_id: raw.task_id,
    };
  } catch {
    return null;
  }
}
