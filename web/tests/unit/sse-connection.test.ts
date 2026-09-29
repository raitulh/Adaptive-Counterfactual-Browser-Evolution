import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "@/lib/api/session";
import { SseConnection, type SseEvent, type StreamState } from "@/lib/realtime/sse";

const ACCESS_TOKEN = "access-token-never-in-urls";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function eventStream(wire: string) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(wire));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out"));
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("SseConnection", () => {
  const fetchMock = vi.fn<(input: Request) => Promise<Response>>();
  let streamTokens = 0;

  beforeEach(() => {
    streamTokens = 0;
    vi.stubGlobal("fetch", fetchMock);
    sessionStore.set({
      accessToken: ACCESS_TOKEN,
      expiresAt: Date.now() + 600_000,
      sessionId: "s",
      tenantId: "t",
      userId: "u",
    });
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    sessionStore.clear();
  });

  function streamRequests() {
    return fetchMock.mock.calls.map(([r]) => r).filter((r) => r.url.includes("/events/stream"));
  }

  it("uses a fresh stream token per connection, resumes with Last-Event-ID and stops on `end`", async () => {
    let streamCalls = 0;
    fetchMock.mockImplementation(async (req: Request) => {
      if (req.url.endsWith("/auth/stream-token")) {
        expect(req.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
        streamTokens += 1;
        return json(200, { token: `stream-${streamTokens}`, expires_in: 120 });
      }
      streamCalls += 1;
      if (streamCalls === 1) {
        // Server closes the connection after one event (e.g. a deploy): the client must resume.
        return eventStream('id: 3\nevent: STEP_COMPLETED\ndata: {"seq":3}\n\n');
      }
      return eventStream(
        'id: 4\nevent: TASK_COMPLETED\ndata: {"seq":4}\n\nevent: end\ndata: {"status":"completed"}\n\n',
      );
    });

    const events: SseEvent[] = [];
    const states: StreamState[] = [];
    const reconnected = vi.fn();
    let lastId: string | null = null;
    const conn = new SseConnection({
      path: "/tasks/t1/events/stream",
      lastEventId: () => lastId,
      onEvent: (e) => {
        events.push(e);
        if (e.id) lastId = e.id;
      },
      onStateChange: (s) => states.push(s),
      onReconnected: reconnected,
      maxBackoffMs: 5,
    });
    conn.start();
    await waitFor(() => conn.currentState === "ended");

    const [first, second] = streamRequests();
    expect(new URL(first!.url).searchParams.get("access_token")).toBe("stream-1");
    expect(new URL(second!.url).searchParams.get("access_token")).toBe("stream-2");
    for (const r of streamRequests()) {
      expect(r.url).not.toContain(ACCESS_TOKEN);
      expect(r.headers.get("authorization")).toBeNull();
    }
    expect(first!.headers.get("last-event-id")).toBeNull();
    expect(second!.headers.get("last-event-id")).toBe("3");
    expect(events.map((e) => e.event)).toEqual(["STEP_COMPLETED", "TASK_COMPLETED", "end"]);
    expect(reconnected).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["connecting", "open", "reconnecting", "open", "ended"]);
  });

  it("gives up after repeated 401s instead of looping", async () => {
    fetchMock.mockImplementation(async (req: Request) => {
      if (req.url.endsWith("/auth/stream-token")) return json(200, { token: "stream", expires_in: 120 });
      return json(401, { error: { code: "invalid_token", message: "m", request_id: null, details: {} } });
    });
    const conn = new SseConnection({ path: "/events/stream", onEvent: () => {}, maxBackoffMs: 5 });
    conn.start();
    await waitFor(() => conn.currentState === "failed");
    expect(streamRequests()).toHaveLength(2);
  });

  it("treats 403/404 as terminal (no access to the task)", async () => {
    fetchMock.mockImplementation(async (req: Request) =>
      req.url.endsWith("/auth/stream-token")
        ? json(200, { token: "stream", expires_in: 120 })
        : json(404, { error: { code: "not_found", message: "m", request_id: null, details: {} } }),
    );
    const conn = new SseConnection({ path: "/tasks/x/events/stream", onEvent: () => {}, maxBackoffMs: 5 });
    conn.start();
    await waitFor(() => conn.currentState === "failed");
    expect(streamRequests()).toHaveLength(1);
  });

  it("stop() aborts the open request and never reconnects", async () => {
    fetchMock.mockImplementation(async (req: Request) => {
      if (req.url.endsWith("/auth/stream-token")) return json(200, { token: "stream", expires_in: 120 });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(": connected\n\n"));
            req.signal.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const conn = new SseConnection({ path: "/events/stream", onEvent: () => {}, maxBackoffMs: 5 });
    conn.start();
    await waitFor(() => conn.currentState === "open");
    conn.stop();
    await new Promise((r) => setTimeout(r, 50));
    expect(conn.currentState).toBe("closed");
    expect(streamRequests()).toHaveLength(1);
  });
});
