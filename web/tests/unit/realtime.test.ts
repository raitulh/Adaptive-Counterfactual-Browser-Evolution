import { describe, expect, it } from "vitest";
import { isContiguous, maxSeq, mergeEvents, parseTaskEvent } from "@/lib/realtime/events";
import { SseParser, type SseEvent } from "@/lib/realtime/sse";
import type { TaskEvent } from "@/lib/api";

const ev = (seq: number, type = "STEP_COMPLETED"): TaskEvent => ({
  seq,
  event_type: type as TaskEvent["event_type"],
  step_id: null,
  actor_type: "system",
  payload: {},
  created_at: "2026-01-01T00:00:00Z",
});

describe("SseParser", () => {
  it("parses events split across arbitrary chunk boundaries, ignoring comments", () => {
    const out: SseEvent[] = [];
    const parser = new SseParser((e) => out.push(e));
    const wire = ': connected\n\nid: 3\nevent: TASK_CREATED\ndata: {"seq":3}\n\n: keep-alive\n\nevent: end\ndata: {"status":"completed"}\n\n';
    for (let i = 0; i < wire.length; i += 7) parser.push(wire.slice(i, i + 7));
    expect(out).toEqual([
      { event: "TASK_CREATED", data: '{"seq":3}', id: "3" },
      { event: "end", data: '{"status":"completed"}', id: "3" },
    ]);
  });

  it("handles CRLF, multi-line data and retry hints", () => {
    const out: SseEvent[] = [];
    const parser = new SseParser((e) => out.push(e));
    parser.push("retry: 5000\r\nevent: stream_unavailable\r\ndata: a\r\ndata: b\r\n\r\n");
    expect(parser.retryMs).toBe(5000);
    expect(out).toEqual([{ event: "stream_unavailable", data: "a\nb", id: null }]);
  });
});

describe("task event merging", () => {
  it("dedupes by seq and keeps order", () => {
    const merged = mergeEvents([ev(1), ev(2)], [ev(2), ev(4), ev(3)]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(isContiguous(merged)).toBe(true);
    expect(maxSeq(merged)).toBe(4);
  });

  it("returns the same array when nothing is new (no re-render)", () => {
    const base = [ev(1)];
    expect(mergeEvents(base, [ev(1)])).toBe(base);
  });

  it("detects gaps", () => {
    expect(isContiguous([ev(1), ev(3)])).toBe(false);
  });

  it("parses SSE payloads into TaskEvent shape", () => {
    const parsed = parseTaskEvent("PLAN_CREATED", '{"seq":5,"task_id":"t","step_id":null,"payload":{"n":1},"created_at":"x"}');
    expect(parsed).toMatchObject({ seq: 5, event_type: "PLAN_CREATED", payload: { n: 1 }, task_id: "t" });
    expect(parseTaskEvent("X", "not json")).toBeNull();
  });
});
