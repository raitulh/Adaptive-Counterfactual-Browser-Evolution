import type { ChallengeTelemetry } from "@/lib/schemas/verification";

/**
 * Interaction telemetry for the verification challenge.
 *
 * Collects pointer, key and visibility events while a challenge is on screen
 * and reduces them to a handful of aggregate features (see
 * `challengeTelemetrySchema`). Raw samples never leave this module.
 */

export interface PointerSample {
  t: number;
  x: number;
  y: number;
}

export interface PathSummary {
  moves: number;
  pathPx: number;
  /** Displacement ÷ path length. 1 = perfectly straight. */
  straightness: number | null;
  /** Coefficient of variation of pointer speed. ~0 = constant speed. */
  speedCv: number | null;
}

export interface BrowserEnvironment {
  webdriver: boolean;
  maxTouchPoints: number;
  /** Milliseconds since the page started loading. */
  pageDwellMs: number;
}

/** Pointer movement in this window before the press counts as the approach. */
export const APPROACH_WINDOW_MS = 3000;
const MAX_SAMPLES = 120;

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

export function summarizePath(samples: readonly PointerSample[]): PathSummary {
  const moves = samples.length;
  if (moves < 2) return { moves, pathPx: 0, straightness: null, speedCv: null };

  let pathPx = 0;
  const speeds: number[] = [];
  for (let index = 1; index < moves; index += 1) {
    const previous = samples[index - 1]!;
    const current = samples[index]!;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    pathPx += distance;
    const elapsed = current.t - previous.t;
    if (elapsed > 0) speeds.push(distance / elapsed);
  }

  const first = samples[0]!;
  const last = samples[moves - 1]!;
  const displacement = Math.hypot(last.x - first.x, last.y - first.y);
  const straightness = pathPx > 0 ? Math.min(1, displacement / pathPx) : null;

  let speedCv: number | null = null;
  if (speeds.length >= 2) {
    const mean = speeds.reduce((sum, speed) => sum + speed, 0) / speeds.length;
    if (mean > 0) {
      const variance = speeds.reduce((sum, speed) => sum + (speed - mean) ** 2, 0) / speeds.length;
      speedCv = round(Math.sqrt(variance) / mean, 3);
    }
  }

  return {
    moves,
    pathPx: round(pathPx, 1),
    straightness: straightness === null ? null : round(straightness, 3),
    speedCv,
  };
}

export interface PressStart {
  pointerType: "mouse" | "pen" | "touch" | null;
  x?: number;
  y?: number;
  trusted: boolean;
}

export interface TelemetryRecorder {
  pointerMove(x: number, y: number, trusted: boolean): void;
  pressStart(press: PressStart): void;
  pressEnd(completed: boolean): void;
  keyRepeat(): void;
  /** A discrete input (e.g. a click) that isn't a press-and-hold. */
  input(trusted: boolean): void;
  visibilityChange(): void;
  snapshot(): ChallengeTelemetry;
}

export interface RecorderOptions {
  now?: () => number;
  environment?: () => BrowserEnvironment;
}

export function createTelemetryRecorder({
  now = () => performance.now(),
  environment = readBrowserEnvironment,
}: RecorderOptions = {}): TelemetryRecorder {
  const readyAt = now();
  let samples: PointerSample[] = [];
  let approach: PathSummary | null = null;
  let pointerType: PressStart["pointerType"] = null;
  let firstInputAt: number | null = null;
  let holdOrigin: { x: number; y: number } | null = null;
  let pressing = false;
  let holdMoves = 0;
  let holdJitterPx = 0;
  let keyRepeats = 0;
  let untrustedEvents = 0;
  let visibilityChanges = 0;
  let earlyReleases = 0;

  const recentSamples = (at: number) => samples.filter((s) => at - s.t <= APPROACH_WINDOW_MS);

  return {
    pointerMove(x, y, trusted) {
      if (!trusted) untrustedEvents += 1;
      if (pressing) {
        if (holdOrigin) {
          holdMoves += 1;
          holdJitterPx = Math.max(holdJitterPx, Math.hypot(x - holdOrigin.x, y - holdOrigin.y));
        }
        return;
      }
      samples.push({ t: now(), x, y });
      if (samples.length > MAX_SAMPLES) samples = samples.slice(-MAX_SAMPLES);
    },
    pressStart({ pointerType: type, x, y, trusted }) {
      const at = now();
      if (!trusted) untrustedEvents += 1;
      firstInputAt ??= at;
      pressing = true;
      pointerType = type;
      holdOrigin = x === undefined || y === undefined ? null : { x, y };
      approach = type === null ? null : summarizePath(recentSamples(at));
    },
    pressEnd(completed) {
      if (!pressing) return;
      pressing = false;
      holdOrigin = null;
      if (!completed) earlyReleases += 1;
    },
    keyRepeat() {
      keyRepeats += 1;
    },
    input(trusted) {
      if (!trusted) untrustedEvents += 1;
      firstInputAt ??= now();
    },
    visibilityChange() {
      visibilityChanges += 1;
    },
    snapshot() {
      const path = approach ?? summarizePath(recentSamples(now()));
      const env = environment();
      return {
        version: 1,
        pointerType,
        approachMoves: path.moves,
        approachPathPx: path.pathPx,
        approachStraightness: path.straightness,
        approachSpeedCv: path.speedCv,
        holdMoves,
        holdJitterPx: round(holdJitterPx, 1),
        timeToFirstInputMs: firstInputAt === null ? null : Math.round(firstInputAt - readyAt),
        keyRepeats,
        untrustedEvents,
        visibilityChanges,
        earlyReleases,
        webdriver: env.webdriver,
        maxTouchPoints: env.maxTouchPoints,
        pageDwellMs: env.pageDwellMs,
      };
    },
  };
}

export function readBrowserEnvironment(): BrowserEnvironment {
  if (typeof navigator === "undefined")
    return { webdriver: false, maxTouchPoints: 0, pageDwellMs: 0 };
  return {
    webdriver: navigator.webdriver === true,
    maxTouchPoints: Math.max(0, Math.round(navigator.maxTouchPoints || 0)),
    pageDwellMs: Math.max(0, Math.round(performance.now())),
  };
}
