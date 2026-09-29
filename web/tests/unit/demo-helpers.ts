/**
 * Helpers for the demo-backend tests. Each test file mocks `@/lib/config/env` to force
 * `demoMode: true` (vi.mock must live in the test file itself), then drives the real API layer.
 */
import { vi } from "vitest";
import { configureDemo, demoFetch, resetDemoBackend } from "@/lib/demo/backend";
import { sessionStore } from "@/lib/api/session";
import { SseConnection, type SseEvent, type StreamState } from "@/lib/realtime/sse";

export const API = "http://localhost:3000/api/v1";

export function freshDemo(timeScale = 0.01): void {
  resetDemoBackend();
  configureDemo({ timeScale });
  sessionStore.clear();
}

export interface Collected {
  events: SseEvent[];
  states: StreamState[];
  conn: SseConnection;
  types(): string[];
}

const open: SseConnection[] = [];

/** Open a stream through the real SSE client (stream token, Last-Event-ID, parser). */
export function listen(path: string, lastEventId: string | null = null): Collected {
  const events: SseEvent[] = [];
  const states: StreamState[] = [];
  const conn = new SseConnection({
    path,
    onEvent: (e) => events.push(e),
    onStateChange: (s) => states.push(s),
    lastEventId: () => lastEventId,
  });
  conn.start();
  open.push(conn);
  return { events, states, conn, types: () => events.map((e) => e.event) };
}

export function closeStreams(): void {
  while (open.length) open.pop()!.stop();
}

/** Poll (sync or async) until `fn` returns a truthy value. */
export async function until<T>(
  fn: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  timeout = 8000,
): Promise<T> {
  return vi.waitFor(
    async () => {
      const v = await fn();
      if (!v) throw new Error("condition not met yet");
      return v;
    },
    { timeout, interval: 5 },
  );
}

/** Raw request straight to the demo backend (for headers/status assertions). */
export function raw(path: string, init: RequestInit = {}): Promise<Response> {
  return demoFetch(new Request(`${API}${path}`, init));
}

/** Assert `expected` appears in `actual` in order (other items may be interleaved). */
export function isSubsequence(expected: string[], actual: string[]): boolean {
  let i = 0;
  for (const a of actual) if (a === expected[i]) i += 1;
  return i === expected.length;
}

export function multipart(fields: Record<string, string | { filename: string; type: string; content: string }>): {
  body: string;
  headers: Record<string, string>;
} {
  const boundary = "----demoBoundary7MA4YWxkTrZu0gW";
  let body = "";
  for (const [name, value] of Object.entries(fields)) {
    body += `--${boundary}\r\n`;
    if (typeof value === "string") {
      body += `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    } else {
      body += `Content-Disposition: form-data; name="${name}"; filename="${value.filename}"\r\nContent-Type: ${value.type}\r\n\r\n${value.content}\r\n`;
    }
  }
  body += `--${boundary}--\r\n`;
  return { body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}
