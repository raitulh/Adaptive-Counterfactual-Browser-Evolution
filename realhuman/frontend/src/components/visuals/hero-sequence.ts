/** The signature sequence shown beside the hero visual. */
export const HERO_SEQUENCE = [
  { label: "Anonymous session", detail: "unverified" },
  { label: "Signal detected", detail: "interaction" },
  { label: "Challenge analyzed", detail: "response" },
  { label: "Pattern verified", detail: "consistency" },
  { label: "Human confidence", detail: "0.93" },
  { label: "Human verified", detail: "token issued" },
] as const;

export const FINAL_PHASE = HERO_SEQUENCE.length - 1;
export const PHASE_INTERVAL_MS = 820;

/** Number of signal nodes lit for a phase (0–4). */
export function litSignalCount(phase: number): number {
  return Math.max(0, Math.min(4, phase));
}
