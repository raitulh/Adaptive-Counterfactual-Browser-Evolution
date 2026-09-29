/**
 * Presentation for evaluation-lab lifecycle values. The backend exposes these as plain strings; the
 * values below mirror its constants (app/evaluation/models.py RunStatus/ExperimentStatus,
 * app/acbe/models.py StrategyStatus, StrategyExperiment.status/decision). Unknown values render
 * neutrally instead of breaking.
 */
import type { StatusMeta } from "@/lib/status";

export const RUN_STATUS: Record<string, StatusMeta> = {
  queued: {
    label: "Queued",
    tone: "neutral",
    live: true,
    description: "Waiting for a dedicated evaluation worker to pick it up.",
  },
  running: {
    label: "Running",
    tone: "accent",
    live: true,
    description: "Executing cases against simulated providers.",
  },
  completed: { label: "Completed", tone: "success", terminal: true, description: "Every case was scored." },
  failed: { label: "Failed", tone: "danger", terminal: true, description: "The run stopped with an error." },
};

export const EXPERIMENT_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", description: "Created; start it to evaluate every variant." },
  running: {
    label: "Running",
    tone: "accent",
    live: true,
    description: "Evaluation runs are queued or executing for each variant.",
  },
  evaluated: {
    label: "Winner found",
    tone: "warning",
    attention: true,
    description: "A challenger beat the control. A person decides whether to roll it out.",
  },
  rejected: {
    label: "No winner",
    tone: "danger",
    description: "No variant beat the control under the statistical and safety gates.",
  },
  canary: {
    label: "Canary",
    tone: "accent",
    live: true,
    description: "The winner serves a share of real tasks while it is observed.",
  },
  promoted: { label: "Promoted", tone: "success", terminal: true, description: "The winner is the default strategy." },
  rolled_back: { label: "Rolled back", tone: "recover", terminal: true, description: "The rollout was reverted." },
};

export const CANDIDATE_STATUS: Record<string, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral", description: "Proposed from a failure pattern; not evaluated yet." },
  evaluating: {
    label: "Evaluating",
    tone: "verify",
    live: true,
    description: "Baseline vs candidate experiment in progress.",
  },
  passed: {
    label: "Passed · needs approval",
    tone: "warning",
    attention: true,
    description: "Passed the promotion gate. A person must approve a canary.",
  },
  rejected: { label: "Rejected", tone: "danger", terminal: true, description: "Failed the promotion gate." },
  canary: {
    label: "Canary",
    tone: "accent",
    live: true,
    description: "Serving a share of real tasks under observation.",
  },
  promoted: { label: "Promoted", tone: "success", description: "Live for every task in its scope." },
  rolled_back: { label: "Rolled back", tone: "recover", terminal: true, description: "Taken out of service." },
  retired: { label: "Retired", tone: "neutral", terminal: true, description: "Superseded and no longer used." },
};

export const CANDIDATE_STATUSES = [
  "draft",
  "evaluating",
  "passed",
  "rejected",
  "canary",
  "promoted",
  "rolled_back",
  "retired",
] as const;

export const STRATEGY_EXPERIMENT_STATUS: Record<string, StatusMeta> = {
  running: { label: "Running", tone: "verify", live: true, description: "Cases are being evaluated." },
  completed: { label: "Completed", tone: "success", description: "The promotion gate reached a decision." },
  aborted: { label: "Aborted", tone: "danger", description: "Stopped before a decision." },
};

export const GATE_DECISION: Record<string, StatusMeta> = {
  passed: {
    label: "Passed",
    tone: "success",
    description: "Better than the baseline with enough confidence, and every safety gate held.",
  },
  rejected: { label: "Rejected", tone: "danger", description: "A safety gate failed or the gain was too small." },
  needs_more_data: {
    label: "Needs more data",
    tone: "warning",
    description: "Not enough trials or confidence to decide.",
  },
};

const UNKNOWN: StatusMeta = { label: "Unknown", tone: "neutral", description: "Unrecognized status" };

export function statusMeta(map: Record<string, StatusMeta>, value: string | null | undefined): StatusMeta {
  if (!value) return UNKNOWN;
  return map[value] ?? { ...UNKNOWN, label: value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) };
}

/** 0–1 rate → "87%"; null/undefined → "—". */
export function pct(value: unknown, digits = 0): string {
  return typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
}

export function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
