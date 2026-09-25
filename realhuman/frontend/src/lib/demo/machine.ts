import type { ApiError } from "@/lib/schemas/api-error";
import type {
  InputMethod,
  VerificationResult,
  VerificationSession,
  VerificationSignal,
} from "@/lib/schemas/verification";
import { formatScore } from "@/lib/utils/format";

/**
 * Pure state machine for the interactive verification demo.
 *
 *   idle → starting → challenge → analyzing → verified
 *                         ↑           ├──→ step_up  (retry challenge)
 *                         │           ├──→ blocked
 *                         │           └──→ error    (retry challenge)
 *                         └── timeout ←── (countdown or server expiry → start over)
 */

export type DemoStatus =
  | "idle"
  | "starting"
  | "challenge"
  | "analyzing"
  | "verified"
  | "step_up"
  | "blocked"
  | "timeout"
  | "error";

export type LogTone = "neutral" | "accent" | "success" | "warning" | "danger";

export interface DemoLogEntry {
  id: number;
  /** Milliseconds since the run started. */
  offsetMs: number;
  event: string;
  detail?: string;
  tone: LogTone;
}

export interface DemoState {
  status: DemoStatus;
  /** Changes on every START so stale async results can be ignored. */
  runId: number;
  attempt: number;
  startedAt: number | null;
  session: VerificationSession | null;
  signals: VerificationSignal[];
  result: VerificationResult | null;
  error: ApiError | null;
  log: DemoLogEntry[];
}

export type DemoEvent =
  | { type: "START"; runId: number; at: number }
  | { type: "SESSION_READY"; runId: number; session: VerificationSession; at: number }
  | { type: "CHALLENGE_SUBMITTED"; runId: number; inputMethod: InputMethod; at: number }
  | { type: "SIGNAL"; runId: number; signal: VerificationSignal; at: number }
  | { type: "RESULT"; runId: number; result: VerificationResult; at: number }
  | { type: "EXPIRED"; runId: number; reason: "countdown" | "server"; at: number }
  | { type: "FAILED"; runId: number; error: ApiError; at: number }
  | { type: "RETRY_CHALLENGE"; at: number }
  | { type: "RESET" };

export const initialDemoState: DemoState = {
  status: "idle",
  runId: 0,
  attempt: 0,
  startedAt: null,
  session: null,
  signals: [],
  result: null,
  error: null,
  log: [],
};

const TERMINAL: ReadonlySet<DemoStatus> = new Set([
  "idle",
  "verified",
  "blocked",
  "timeout",
  "error",
  "step_up",
]);

function appendLog(
  state: DemoState,
  at: number,
  event: string,
  tone: LogTone,
  detail?: string,
): DemoLogEntry[] {
  const offsetMs = state.startedAt === null ? 0 : at - state.startedAt;
  const entry: DemoLogEntry = {
    id: state.log.length,
    offsetMs,
    event,
    tone,
    ...(detail ? { detail } : {}),
  };
  // Keep the console bounded.
  return [...state.log, entry].slice(-40);
}

function signalTone(signal: VerificationSignal): LogTone {
  // Green is reserved for the final verified decision.
  if (signal.status === "pass") return "accent";
  if (signal.status === "fail") return "danger";
  return "warning";
}

export function demoReducer(state: DemoState, event: DemoEvent): DemoState {
  // Run ids start at 1, so resetting to 0 also invalidates any in-flight events.
  if (event.type === "RESET") return initialDemoState;

  if (event.type === "START") {
    if (!TERMINAL.has(state.status)) return state;
    const next: DemoState = {
      ...initialDemoState,
      status: "starting",
      runId: event.runId,
      startedAt: event.at,
    };
    return {
      ...next,
      log: appendLog(next, event.at, "session.create", "neutral", "POST /v1/sessions"),
    };
  }

  if (event.type === "RETRY_CHALLENGE") {
    if ((state.status !== "step_up" && state.status !== "error") || !state.session) return state;
    const next: DemoState = {
      ...state,
      status: "challenge",
      attempt: state.attempt + 1,
      signals: [],
      result: null,
      error: null,
    };
    return {
      ...next,
      log: appendLog(next, event.at, "challenge.reissued", "accent", `attempt ${next.attempt + 1}`),
    };
  }

  // All remaining events belong to a specific run; ignore stale ones.
  if (event.runId !== state.runId) return state;

  switch (event.type) {
    case "SESSION_READY": {
      if (state.status !== "starting") return state;
      const next: DemoState = { ...state, status: "challenge", session: event.session };
      return {
        ...next,
        log: appendLog(
          next,
          event.at,
          "session.created",
          "accent",
          `ttl ${event.session.challenge.ttlSeconds}s`,
        ),
      };
    }

    case "CHALLENGE_SUBMITTED": {
      if (state.status !== "challenge") return state;
      const next: DemoState = { ...state, status: "analyzing", signals: [] };
      return {
        ...next,
        log: appendLog(
          next,
          event.at,
          "challenge.completed",
          "neutral",
          `input ${event.inputMethod}`,
        ),
      };
    }

    case "SIGNAL": {
      if (state.status !== "analyzing") return state;
      const signals = [...state.signals.filter((s) => s.id !== event.signal.id), event.signal];
      const next: DemoState = { ...state, signals };
      return {
        ...next,
        log: appendLog(
          next,
          event.at,
          `signal.${event.signal.id}`,
          signalTone(event.signal),
          `${event.signal.status} ${formatScore(event.signal.score)}`,
        ),
      };
    }

    case "RESULT": {
      if (state.status !== "analyzing") return state;
      const { result } = event;
      const status: DemoStatus =
        result.decision === "allow"
          ? "verified"
          : result.decision === "step_up"
            ? "step_up"
            : "blocked";
      const next: DemoState = { ...state, status, result, signals: result.signals };
      const tone: LogTone =
        status === "verified" ? "success" : status === "blocked" ? "danger" : "warning";
      return {
        ...next,
        log: appendLog(
          next,
          event.at,
          `decision.${result.decision}`,
          tone,
          `score ${formatScore(result.score)} · risk ${result.risk}`,
        ),
      };
    }

    case "EXPIRED": {
      if (state.status !== "challenge" && state.status !== "analyzing") return state;
      const next: DemoState = { ...state, status: "timeout" };
      return {
        ...next,
        log: appendLog(
          next,
          event.at,
          "session.expired",
          "warning",
          event.reason === "countdown"
            ? "challenge not completed in time"
            : "expired during analysis",
        ),
      };
    }

    case "FAILED": {
      if (state.status === "idle" || TERMINAL.has(state.status)) return state;
      if (event.error.code === "SESSION_EXPIRED") {
        return demoReducer(state, {
          type: "EXPIRED",
          runId: event.runId,
          reason: "server",
          at: event.at,
        });
      }
      const next: DemoState = { ...state, status: "error", error: event.error };
      return {
        ...next,
        log: appendLog(next, event.at, "request.failed", "warning", event.error.code.toLowerCase()),
      };
    }
  }
}
