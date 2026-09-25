"use client";

import { useCallback, useEffect, useState } from "react";
import { FINAL_PHASE, PHASE_INTERVAL_MS } from "@/components/visuals/hero-sequence";

/**
 * Plays the hero verification sequence once when `active` first becomes true,
 * then holds the verified state. `replay()` restarts it. Reduced-motion users
 * see the final state without the sequence.
 */
export function useHeroSequence(active: boolean, reducedMotion: boolean) {
  const [phase, setPhase] = useState(0);
  const [playId, setPlayId] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!active || reducedMotion || started) return;
    const timer = setTimeout(() => setStarted(true), 450);
    return () => clearTimeout(timer);
  }, [active, reducedMotion, started]);

  useEffect(() => {
    if (!started || reducedMotion) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let next = 1; next <= FINAL_PHASE; next += 1) {
      timers.push(setTimeout(() => setPhase(next), next * PHASE_INTERVAL_MS));
    }
    return () => timers.forEach(clearTimeout);
  }, [started, playId, reducedMotion]);

  const replay = useCallback(() => {
    setPhase(0);
    setStarted(true);
    setPlayId((id) => id + 1);
  }, []);

  return {
    phase: reducedMotion ? FINAL_PHASE : phase,
    replay,
    done: reducedMotion || phase === FINAL_PHASE,
  };
}
