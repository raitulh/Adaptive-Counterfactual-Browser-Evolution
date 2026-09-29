/**
 * Multi-file upload queue: a pure state machine (`uploadReducer`) plus a small controller
 * (`createUploadQueue`) that runs uploads with bounded concurrency, progress, cancellation
 * (AbortSignal) and retries.
 *
 *   queued ──start──▶ uploading ──progress=1──▶ sending ──succeeded──▶ done
 *     │                 │                        │
 *     └──cancel──▶ cancelled ◀──cancel───────────┘      failed ◀──failed── uploading | sending
 *                     │  └──────────retry (same idempotency key)──────▶ queued ◀──retry── failed
 *   rejected (client-side validation; never sent)
 *
 * One idempotency key per logical upload: a retry of the same file reuses it, so the backend
 * returns the original result instead of storing the file twice.
 */
import type { FileOut, UploadOptions, UploadPurpose } from "@/lib/api";
import { normalizeError } from "@/lib/api/errors";

export type UploadPhase = "queued" | "uploading" | "sending" | "done" | "failed" | "cancelled" | "rejected";

export interface UploadError {
  message: string;
  code: string;
  retryable: boolean;
}

export interface UploadItem {
  id: string;
  file: File;
  name: string;
  size: number;
  purpose: UploadPurpose;
  idempotencyKey: string;
  phase: UploadPhase;
  /** Fraction of bytes sent, 0..1. */
  progress: number;
  attempts: number;
  error: UploadError | null;
  result: FileOut | null;
  /** Cancelled after every byte was sent: the server may still have stored the file. */
  cancelledAfterSend: boolean;
}

export type UploadAction =
  | { type: "add"; items: UploadItem[] }
  | { type: "start"; id: string }
  | { type: "progress"; id: string; fraction: number }
  | { type: "succeeded"; id: string; file: FileOut }
  | { type: "failed"; id: string; error: UploadError }
  | { type: "cancelled"; id: string }
  | { type: "retry"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "clearFinished" };

export const ACTIVE_PHASES: readonly UploadPhase[] = ["uploading", "sending"];
export const TERMINAL_PHASES: readonly UploadPhase[] = ["done", "failed", "cancelled", "rejected"];

export const isActive = (item: UploadItem) => ACTIVE_PHASES.includes(item.phase);
export const canRetry = (item: UploadItem) =>
  item.phase === "cancelled" || (item.phase === "failed" && Boolean(item.error?.retryable));
export const canCancel = (item: UploadItem) => item.phase === "queued" || isActive(item);

function update(state: UploadItem[], id: string, fn: (item: UploadItem) => UploadItem | null): UploadItem[] {
  let changed = false;
  const next: UploadItem[] = [];
  for (const item of state) {
    if (item.id !== id) {
      next.push(item);
      continue;
    }
    const out = fn(item);
    if (out !== item) changed = true;
    if (out) next.push(out);
  }
  return changed ? next : state;
}

export function uploadReducer(state: UploadItem[], action: UploadAction): UploadItem[] {
  switch (action.type) {
    case "add":
      return [...state, ...action.items];
    case "start":
      return update(state, action.id, (i) =>
        i.phase === "queued" ? { ...i, phase: "uploading", progress: 0, attempts: i.attempts + 1, error: null } : i,
      );
    case "progress":
      return update(state, action.id, (i) => {
        if (!isActive(i)) return i;
        const fraction = Math.max(i.progress, Math.min(1, Math.max(0, action.fraction)));
        const phase: UploadPhase = fraction >= 1 ? "sending" : "uploading";
        return fraction === i.progress && phase === i.phase ? i : { ...i, progress: fraction, phase };
      });
    case "succeeded":
      return update(state, action.id, (i) =>
        isActive(i) ? { ...i, phase: "done", progress: 1, result: action.file, error: null } : i,
      );
    case "failed":
      return update(state, action.id, (i) => (isActive(i) ? { ...i, phase: "failed", error: action.error } : i));
    case "cancelled":
      return update(state, action.id, (i) =>
        canCancel(i) ? { ...i, phase: "cancelled", cancelledAfterSend: i.phase === "sending", error: null } : i,
      );
    case "retry":
      return update(state, action.id, (i) =>
        canRetry(i) ? { ...i, phase: "queued", progress: 0, error: null, cancelledAfterSend: false } : i,
      );
    case "dismiss":
      return update(state, action.id, (i) => (TERMINAL_PHASES.includes(i.phase) ? null : i));
    case "clearFinished": {
      const next = state.filter((i) => !(i.phase === "done" || i.phase === "cancelled" || i.phase === "rejected"));
      return next.length === state.length ? state : next;
    }
  }
}

export function toUploadError(err: unknown): UploadError {
  const e = normalizeError(err);
  return { message: e.userMessage, code: e.code, retryable: e.isRetryable };
}

export type UploadFn = (file: File, options: UploadOptions) => Promise<FileOut>;

export interface UploadQueueOptions {
  upload: UploadFn;
  concurrency?: number;
  newKey?: () => string;
  newId?: () => string;
  /** Client-side validation; returns a reason to refuse the file, or null. */
  validate?: (file: File) => string | null;
  onUploaded?: (file: FileOut, item: UploadItem) => void;
  /** Called when an upload was cancelled after its bytes were sent (the server may have kept it). */
  onSettled?: (item: UploadItem) => void;
}

export interface UploadQueue {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => UploadItem[];
  add: (files: File[], purpose?: UploadPurpose) => UploadItem[];
  cancel: (id: string) => void;
  cancelAll: () => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  dispose: () => void;
}

let fallbackCounter = 0;
const defaultId = () =>
  typeof globalThis.crypto?.randomUUID === "function" ? globalThis.crypto.randomUUID() : `u-${Date.now()}-${++fallbackCounter}`;

export function createUploadQueue(options: UploadQueueOptions): UploadQueue {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const newKey = options.newKey ?? defaultId;
  const newId = options.newId ?? defaultId;
  let state: UploadItem[] = [];
  const listeners = new Set<() => void>();
  const controllers = new Map<string, AbortController>();
  let disposed = false;

  const find = (id: string) => state.find((i) => i.id === id);
  const dispatch = (action: UploadAction) => {
    const next = uploadReducer(state, action);
    if (next === state) return;
    state = next;
    for (const l of listeners) l();
  };

  async function run(id: string) {
    dispatch({ type: "start", id });
    const item = find(id);
    if (!item || item.phase !== "uploading") return;
    const attempt = item.attempts;
    const controller = new AbortController();
    controllers.set(id, controller);
    /** The item as long as it is still this attempt (a retry after cancel starts a new one). */
    const current = () => {
      const now = find(id);
      return now && now.attempts === attempt ? now : undefined;
    };
    try {
      const out = await options.upload(item.file, {
        purpose: item.purpose,
        signal: controller.signal,
        idempotencyKey: item.idempotencyKey,
        onProgress: (fraction) => {
          if (current()) dispatch({ type: "progress", id, fraction });
        },
      });
      if (controller.signal.aborted) {
        // cancel() already moved the item to "cancelled"; the server may still have stored it.
        const settled = current();
        if (settled) options.onSettled?.(settled);
        return;
      }
      dispatch({ type: "succeeded", id, file: out });
      const done = current();
      if (done) options.onUploaded?.(out, done);
    } catch (err) {
      if (controller.signal.aborted) {
        const settled = current();
        if (settled) options.onSettled?.(settled);
      } else if (current() && isActive(current()!)) {
        const e = normalizeError(err);
        dispatch(e.kind === "aborted" ? { type: "cancelled", id } : { type: "failed", id, error: toUploadError(e) });
        const settled = current();
        if (settled) options.onSettled?.(settled);
      }
    } finally {
      if (controllers.get(id) === controller) controllers.delete(id);
      pump();
    }
  }

  function pump() {
    if (disposed) return;
    let slots = concurrency - state.filter(isActive).length;
    for (const item of state) {
      if (slots <= 0) break;
      if (item.phase === "queued" && !controllers.has(item.id)) {
        slots--;
        void run(item.id);
      }
    }
  }

  function cancel(id: string) {
    // Reflect the cancellation immediately; an in-flight upload then settles as "aborted".
    dispatch({ type: "cancelled", id });
    const controller = controllers.get(id);
    if (controller) {
      controllers.delete(id); // a retry may start right away
      controller.abort();
    }
    pump();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    add(files, purpose = "user_upload") {
      const items = files.map<UploadItem>((file) => {
        const reason = options.validate?.(file) ?? null;
        return {
          id: newId(),
          file,
          name: file.name,
          size: file.size,
          purpose,
          idempotencyKey: newKey(),
          phase: reason ? "rejected" : "queued",
          progress: 0,
          attempts: 0,
          error: reason ? { message: reason, code: "client_validation", retryable: false } : null,
          result: null,
          cancelledAfterSend: false,
        };
      });
      if (items.length) dispatch({ type: "add", items });
      pump();
      return items;
    },
    cancel,
    cancelAll() {
      for (const item of state) if (canCancel(item)) cancel(item.id);
    },
    retry(id) {
      dispatch({ type: "retry", id });
      pump();
    },
    dismiss(id) {
      dispatch({ type: "dismiss", id });
    },
    clearFinished() {
      dispatch({ type: "clearFinished" });
    },
    dispose() {
      disposed = true;
      for (const c of controllers.values()) c.abort();
      controllers.clear();
      listeners.clear();
    },
  };
}
