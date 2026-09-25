"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { isAbortError, toApiError } from "@/lib/api/errors";
import { loadApi } from "@/lib/api/load";
import type { DemoScenario } from "@/lib/api/types";
import { demoReducer, initialDemoState } from "@/lib/demo/machine";
import type { ChallengeResponse } from "@/lib/schemas/verification";

/**
 * Orchestrates the demo: talks to the configured adapter, feeds events into
 * the pure reducer, runs the challenge countdown, and cancels in-flight work
 * on reset or unmount.
 *
 * Scenario semantics (mock mode): the selected failure is shown once; the
 * recovery path (retry / start over) then succeeds, so every scenario can be
 * completed end to end.
 */
export function useVerificationDemo() {
  const [state, dispatch] = useReducer(demoReducer, initialDemoState);
  const [scenario, setScenarioState] = useState<DemoScenario>("success");
  const [now, setNow] = useState(() => Date.now());
  const scenarioConsumed = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const runCounter = useRef(0);

  const abortInFlight = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
  }, []);

  useEffect(() => abortInFlight, [abortInFlight]);

  const start = useCallback(async () => {
    abortInFlight();
    const ac = new AbortController();
    controller.current = ac;
    runCounter.current += 1;
    const runId = runCounter.current;
    dispatch({ type: "START", runId, at: performance.now() });
    try {
      const api = await loadApi();
      const session = await api.verification.createSession(
        { action: "demo_signup" },
        { signal: ac.signal },
      );
      dispatch({ type: "SESSION_READY", runId, session, at: performance.now() });
    } catch (error) {
      if (isAbortError(error)) return;
      dispatch({ type: "FAILED", runId, error: toApiError(error), at: performance.now() });
    }
  }, [abortInFlight]);

  const submit = useCallback(
    async (response: ChallengeResponse) => {
      const session = state.session;
      if (!session || state.status !== "challenge") return;
      abortInFlight();
      const ac = new AbortController();
      controller.current = ac;
      const runId = state.runId;
      const effectiveScenario: DemoScenario = scenarioConsumed.current ? "success" : scenario;
      if (scenario !== "success") scenarioConsumed.current = true;

      dispatch({
        type: "CHALLENGE_SUBMITTED",
        runId,
        inputMethod: response.inputMethod,
        at: performance.now(),
      });
      try {
        const api = await loadApi();
        const result = await api.verification.submitChallenge(session.id, response, {
          signal: ac.signal,
          scenario: effectiveScenario,
          onSignal: (signal) => dispatch({ type: "SIGNAL", runId, signal, at: performance.now() }),
        });
        dispatch({ type: "RESULT", runId, result, at: performance.now() });
      } catch (error) {
        if (isAbortError(error)) return;
        dispatch({ type: "FAILED", runId, error: toApiError(error), at: performance.now() });
      }
    },
    [abortInFlight, scenario, state.runId, state.session, state.status],
  );

  /** Retry from step-up or error: reuse the session while it is still valid. */
  const retry = useCallback(() => {
    const expiresAt = state.session ? Date.parse(state.session.expiresAt) : 0;
    if (state.session && expiresAt > Date.now()) {
      dispatch({ type: "RETRY_CHALLENGE", at: performance.now() });
    } else {
      void start();
    }
  }, [start, state.session]);

  /** Start again from a finished run; replays the selected scenario. */
  const runAgain = useCallback(() => {
    scenarioConsumed.current = false;
    void start();
  }, [start]);

  const reset = useCallback(() => {
    abortInFlight();
    scenarioConsumed.current = false;
    dispatch({ type: "RESET" });
  }, [abortInFlight]);

  const setScenario = useCallback(
    (next: DemoScenario) => {
      setScenarioState(next);
      reset();
    },
    [reset],
  );

  // Challenge countdown. Expiry is a real product state, not decoration.
  const challengeSession = state.status === "challenge" ? state.session : null;
  useEffect(() => {
    if (!challengeSession) return;
    const expiresAt = Date.parse(challengeSession.expiresAt);
    const runId = state.runId;
    const interval = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= expiresAt)
        dispatch({ type: "EXPIRED", runId, reason: "countdown", at: performance.now() });
    }, 250);
    return () => clearInterval(interval);
  }, [challengeSession, state.runId]);

  const secondsLeft = challengeSession
    ? Math.min(
        challengeSession.challenge.ttlSeconds,
        Math.max(0, Math.ceil((Date.parse(challengeSession.expiresAt) - now) / 1000)),
      )
    : null;

  return { state, scenario, setScenario, secondsLeft, start, submit, retry, runAgain, reset };
}

export type VerificationDemo = ReturnType<typeof useVerificationDemo>;
