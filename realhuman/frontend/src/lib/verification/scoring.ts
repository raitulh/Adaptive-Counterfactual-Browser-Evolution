import type {
  Decision,
  RiskLevel,
  SignalId,
  SignalStatus,
  VerificationSignal,
} from "@/lib/schemas/verification";
import { SIGNAL_BY_ID } from "@/lib/verification/signals";

/**
 * Policy thresholds. A score at or above `allowAt` is allowed, a score at or
 * above `stepUpAt` gets an additional challenge, anything lower is denied.
 */
export interface VerificationPolicy {
  allowAt: number;
  stepUpAt: number;
}

export const DEFAULT_POLICY: VerificationPolicy = { allowAt: 0.8, stepUpAt: 0.5 };

/** Per-signal classification thresholds. */
export const SIGNAL_PASS_AT = 0.75;
export const SIGNAL_REVIEW_AT = 0.5;

export function classifySignal(score: number): Exclude<SignalStatus, "pending"> {
  if (score >= SIGNAL_PASS_AT) return "pass";
  if (score >= SIGNAL_REVIEW_AT) return "review";
  return "fail";
}

/** Builds a signal from a catalog id and a score, using catalog label and weight. */
export function makeSignal(id: SignalId, score: number, detail?: string): VerificationSignal {
  const definition = SIGNAL_BY_ID[id];
  return {
    id,
    label: definition.label,
    weight: definition.weight,
    score: roundScore(score),
    status: classifySignal(score),
    ...(detail ? { detail } : {}),
  };
}

export function roundScore(value: number): number {
  return Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
}

/**
 * Weighted mean of all resolved signals. Pending signals are ignored so a
 * partial result never looks more certain than it is.
 */
export function aggregateScore(signals: readonly VerificationSignal[]): number {
  let weighted = 0;
  let totalWeight = 0;
  for (const signal of signals) {
    if (signal.status === "pending") continue;
    weighted += signal.score * signal.weight;
    totalWeight += signal.weight;
  }
  if (totalWeight === 0) return 0;
  return roundScore(weighted / totalWeight);
}

export function riskFromScore(
  score: number,
  policy: VerificationPolicy = DEFAULT_POLICY,
): RiskLevel {
  if (score >= policy.allowAt) return "low";
  if (score >= policy.stepUpAt) return "medium";
  return "high";
}

/**
 * No single signal decides: the aggregate drives the decision, and a single
 * failing signal can only lower an "allow" to a "step_up" — never deny alone.
 */
export function decide(
  signals: readonly VerificationSignal[],
  policy: VerificationPolicy = DEFAULT_POLICY,
): { decision: Decision; score: number; risk: RiskLevel } {
  const score = aggregateScore(signals);
  const hasFailure = signals.some((signal) => signal.status === "fail");
  let decision: Decision;
  if (score >= policy.allowAt) decision = hasFailure ? "step_up" : "allow";
  else if (score >= policy.stepUpAt) decision = "step_up";
  else decision = "deny";
  const risk =
    decision === "step_up" && score >= policy.allowAt ? "medium" : riskFromScore(score, policy);
  return { decision, score, risk };
}
