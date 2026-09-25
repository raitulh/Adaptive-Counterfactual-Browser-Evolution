import type { SignalId } from "@/lib/schemas/verification";

export interface SignalDefinition {
  id: SignalId;
  label: string;
  /** Monospace identifier shown in technical UI. */
  key: `signal.${SignalId}`;
  weight: number;
  summary: string;
}

/**
 * The signal catalog. Weights sum to 1 and are the defaults applied by the
 * policy engine; projects can tune them.
 */
export const SIGNALS: readonly SignalDefinition[] = [
  {
    id: "interaction_pattern",
    label: "Interaction pattern",
    key: "signal.interaction_pattern",
    weight: 0.3,
    summary: "Timing and variance of the input that completed the challenge.",
  },
  {
    id: "challenge_response",
    label: "Challenge response",
    key: "signal.challenge_response",
    weight: 0.3,
    summary: "Whether the challenge was completed as issued, within its time window.",
  },
  {
    id: "session_consistency",
    label: "Session consistency",
    key: "signal.session_consistency",
    weight: 0.2,
    summary: "Whether the session's properties stay coherent from start to finish.",
  },
  {
    id: "request_behavior",
    label: "Request behavior",
    key: "signal.request_behavior",
    weight: 0.2,
    summary: "Request cadence and sequencing compared with the configured flow.",
  },
] as const;

export const SIGNAL_BY_ID: Record<SignalId, SignalDefinition> = Object.fromEntries(
  SIGNALS.map((signal) => [signal.id, signal]),
) as Record<SignalId, SignalDefinition>;
