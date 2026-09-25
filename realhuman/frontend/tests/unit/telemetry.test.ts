import { describe, expect, it } from "vitest";
import { challengeResponseSchema } from "@/lib/schemas/verification";
import {
  APPROACH_WINDOW_MS,
  createTelemetryRecorder,
  summarizePath,
  type PointerSample,
} from "@/lib/verification/telemetry";

const environment = () => ({ webdriver: false, maxTouchPoints: 0, pageDwellMs: 12_000 });

function clock(start = 1_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe("summarizePath", () => {
  it("needs at least two samples", () => {
    expect(summarizePath([{ t: 0, x: 1, y: 1 }])).toEqual({
      moves: 1,
      pathPx: 0,
      straightness: null,
      speedCv: null,
    });
  });

  it("detects a straight, constant-speed path", () => {
    const samples: PointerSample[] = Array.from({ length: 10 }, (_, i) => ({
      t: i * 10,
      x: i * 5,
      y: i * 5,
    }));
    const summary = summarizePath(samples);
    expect(summary.moves).toBe(10);
    expect(summary.straightness).toBe(1);
    expect(summary.speedCv).toBe(0);
  });

  it("measures curved, variable-speed paths", () => {
    const samples: PointerSample[] = [
      { t: 0, x: 0, y: 0 },
      { t: 16, x: 12, y: 3 },
      { t: 40, x: 20, y: 15 },
      { t: 48, x: 21, y: 30 },
      { t: 90, x: 35, y: 31 },
    ];
    const summary = summarizePath(samples);
    expect(summary.straightness).toBeGreaterThan(0);
    expect(summary.straightness).toBeLessThan(0.95);
    expect(summary.speedCv).toBeGreaterThan(0.2);
  });
});

describe("createTelemetryRecorder", () => {
  it("records reaction time, approach path and hold jitter", () => {
    const time = clock();
    const recorder = createTelemetryRecorder({ now: time.now, environment });
    for (let i = 0; i < 6; i += 1) {
      time.advance(16 + i * 4);
      recorder.pointerMove(100 + i * 9, 200 + (i % 2) * 6, true);
    }
    time.advance(300);
    recorder.pressStart({ pointerType: "mouse", x: 150, y: 205, trusted: true });
    recorder.pointerMove(151, 207, true);
    recorder.pressEnd(true);

    const telemetry = recorder.snapshot();
    expect(telemetry.pointerType).toBe("mouse");
    expect(telemetry.approachMoves).toBe(6);
    expect(telemetry.holdMoves).toBe(1);
    expect(telemetry.holdJitterPx).toBeCloseTo(2.2, 1);
    // 6 moves (16+20+24+28+32+36 ms) then 300 ms before the press.
    expect(telemetry.timeToFirstInputMs).toBe(456);
    expect(telemetry.untrustedEvents).toBe(0);
    expect(telemetry.pageDwellMs).toBe(12_000);
    expect(
      challengeResponseSchema.safeParse({
        type: "press_hold",
        inputMethod: "pointer",
        holdDurationMs: 1100,
        telemetry,
      }).success,
    ).toBe(true);
  });

  it("ignores pointer movement older than the approach window", () => {
    const time = clock();
    const recorder = createTelemetryRecorder({ now: time.now, environment });
    recorder.pointerMove(0, 0, true);
    recorder.pointerMove(10, 10, true);
    time.advance(APPROACH_WINDOW_MS + 1);
    recorder.pressStart({ pointerType: "mouse", x: 10, y: 10, trusted: true });
    expect(recorder.snapshot().approachMoves).toBe(0);
  });

  it("counts synthetic events, key repeats, early releases and hidden pages", () => {
    const recorder = createTelemetryRecorder({ now: clock().now, environment });
    recorder.pressStart({ pointerType: null, trusted: false });
    recorder.pressEnd(false);
    recorder.pressEnd(false); // no press in progress: ignored
    recorder.pressStart({ pointerType: null, trusted: true });
    recorder.keyRepeat();
    recorder.keyRepeat();
    recorder.visibilityChange();
    const telemetry = recorder.snapshot();
    expect(telemetry.untrustedEvents).toBe(1);
    expect(telemetry.earlyReleases).toBe(1);
    expect(telemetry.keyRepeats).toBe(2);
    expect(telemetry.visibilityChanges).toBe(1);
    expect(telemetry.pointerType).toBeNull();
  });

  it("reports no input time until the user acts", () => {
    const recorder = createTelemetryRecorder({ now: clock().now, environment });
    expect(recorder.snapshot().timeToFirstInputMs).toBeNull();
  });
});
