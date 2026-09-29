/**
 * Resilient Server-Sent Events client built on fetch streaming.
 *
 * Why not `EventSource`: every (re)connect needs a *fresh* short-lived stream token (TTL ~120 s) in
 * the URL, and resuming must send `Last-Event-ID` on a brand-new connection — EventSource can do
 * neither. This client:
 *   - requests a new stream token for every connection attempt (never uses access tokens in URLs);
 *   - sends `Last-Event-ID` so the backend replays durable events after the last one seen;
 *   - reconnects with capped exponential backoff + jitter on network errors, 5xx and idle timeouts;
 *   - stops on `event: end` (task reached a final state) or when the caller aborts;
 *   - treats 401/403/404 as terminal after one retry (the session or access is gone).
 */
import { authApi } from "@/lib/api/auth";
import { normalizeError } from "@/lib/api/errors";
import { apiBase } from "@/lib/api/session";
import { getTransport } from "@/lib/api/transport";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "ended" | "closed" | "failed";

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

export interface SseOptions {
  /** API path after /api/v1, e.g. `/tasks/<id>/events/stream`. */
  path: string;
  /** Returns the last event id to resume from (read at every connect). */
  lastEventId?: () => string | null;
  onEvent: (event: SseEvent) => void;
  onStateChange?: (state: StreamState, detail?: { attempt: number; error?: string }) => void;
  /** Called after a successful RE-connect (not the first connect) — reconcile durable state here. */
  onReconnected?: () => void;
  /** Close and reconnect if nothing (not even keep-alives) arrives for this long. */
  idleTimeoutMs?: number;
  maxBackoffMs?: number;
}

const DEFAULT_IDLE_MS = 45_000; // backend sends keep-alives every ~15 s
const DEFAULT_MAX_BACKOFF_MS = 30_000;

/** Incremental text/event-stream parser (WHATWG spec subset used by the backend). */
export class SseParser {
  private buffer = "";
  private data: string[] = [];
  private eventName = "";
  private lastId: string | null = null;
  retryMs: number | null = null;

  constructor(private readonly emit: (event: SseEvent) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) >= 0) {
      const line = this.buffer.slice(0, newline);
      const sepLen = this.buffer.startsWith("\r\n", newline) ? 2 : 1;
      this.buffer = this.buffer.slice(newline + sepLen);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === "") {
      if (this.data.length > 0) {
        this.emit({ event: this.eventName || "message", data: this.data.join("\n"), id: this.lastId });
      }
      this.data = [];
      this.eventName = "";
      return;
    }
    if (line.startsWith(":")) return; // comment / keep-alive
    const idx = line.indexOf(":");
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? "" : line.slice(idx + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        this.eventName = value;
        break;
      case "data":
        this.data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) this.lastId = value;
        break;
      case "retry": {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 0) this.retryMs = n;
        break;
      }
    }
  }
}

function backoff(attempt: number, maxMs: number, serverRetryMs: number | null): number {
  const base = serverRetryMs ?? Math.min(maxMs, 1000 * 2 ** Math.max(0, attempt - 1));
  return Math.min(maxMs, base) * (0.8 + Math.random() * 0.4);
}

export class SseConnection {
  private controller: AbortController | null = null;
  private stopped = false;
  private state: StreamState = "idle";
  private attempt = 0;
  private everOpened = false;
  private serverRetryMs: number | null = null;

  constructor(private readonly opts: SseOptions) {}

  get currentState(): StreamState {
    return this.state;
  }

  start(): void {
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    this.controller?.abort();
    this.setState("closed");
  }

  private setState(state: StreamState, detail?: { error?: string }): void {
    if (this.state === state && !detail) return;
    this.state = state;
    this.opts.onStateChange?.(state, { attempt: this.attempt, ...detail });
  }

  private async loop(): Promise<void> {
    let authFailures = 0;
    while (!this.stopped) {
      this.attempt += 1;
      this.setState(this.everOpened || this.attempt > 1 ? "reconnecting" : "connecting");
      const outcome = await this.connectOnce();
      if (this.stopped) return;
      if (outcome === "ended") {
        this.setState("ended");
        return;
      }
      if (outcome === "auth") {
        authFailures += 1;
        if (authFailures > 1) {
          this.setState("failed", { error: "unauthorized" });
          return;
        }
      } else if (outcome === "fatal") {
        this.setState("failed", { error: "not_available" });
        return;
      } else {
        authFailures = 0;
      }
      const wait = backoff(this.attempt, this.opts.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS, this.serverRetryMs);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  /** One connection attempt. Resolves when the stream closes. */
  private async connectOnce(): Promise<"ended" | "retry" | "auth" | "fatal"> {
    const controller = new AbortController();
    this.controller = controller;
    let token: string;
    try {
      token = (await authApi.streamToken()).token;
    } catch (err) {
      const e = normalizeError(err);
      return e.kind === "unauthorized" ? "auth" : e.kind === "forbidden" ? "fatal" : "retry";
    }
    if (this.stopped) return "retry";

    const url = `${apiBase()}${this.opts.path}?access_token=${encodeURIComponent(token)}`;
    const headers: Record<string, string> = { accept: "text/event-stream", "cache-control": "no-cache" };
    const lastId = this.opts.lastEventId?.();
    if (lastId) headers["last-event-id"] = lastId;

    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), this.opts.idleTimeoutMs ?? DEFAULT_IDLE_MS);
    };

    let ended = false;
    try {
      const transport = await getTransport();
      const response = await transport(
        new Request(url, { headers, signal: controller.signal, cache: "no-store", credentials: "include" }),
      );
      if (response.status === 401) return "auth";
      if (response.status === 403 || response.status === 404) return "fatal";
      if (!response.ok || !response.body) return "retry";

      const wasReconnect = this.everOpened;
      this.everOpened = true;
      this.attempt = 0;
      this.setState("open");
      if (wasReconnect) this.opts.onReconnected?.();
      armIdle();

      const parser = new SseParser((evt) => {
        if (evt.event === "end") ended = true;
        this.opts.onEvent(evt);
      });
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        armIdle();
        parser.push(value);
        if (parser.retryMs !== null) this.serverRetryMs = parser.retryMs;
        if (ended) {
          controller.abort();
          break;
        }
      }
    } catch {
      // network error, idle timeout or stop(): fall through to reconnect unless stopped
    } finally {
      if (idleTimer) clearTimeout(idleTimer);
    }
    return ended ? "ended" : "retry";
  }
}
