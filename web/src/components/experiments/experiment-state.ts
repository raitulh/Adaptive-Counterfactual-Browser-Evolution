/**
 * Experiment lifecycle → available actions and stepper stages (pure). Mirrors the preconditions in
 * backend app/evaluation/service.py; the backend still decides (409 otherwise).
 */
import type { EvaluationExperimentOut, EvaluationRunOut } from "@/lib/api";

type Experiment = Pick<EvaluationExperimentOut, "status" | "winner_variant" | "variants">;

export function controlName(exp: Pick<EvaluationExperimentOut, "variants">): string | null {
  const first = exp.variants?.[0];
  return first && typeof first.name === "string" ? first.name : null;
}

export function experimentActions(exp: Experiment) {
  const s = exp.status;
  const control = controlName(exp);
  const challengerWon = Boolean(exp.winner_variant) && exp.winner_variant !== control;
  return {
    start: s === "draft",
    decide: s === "running" || s === "evaluated" || s === "rejected",
    canary: (s === "evaluated" || s === "canary") && challengerWon,
    promote: s === "canary" && challengerWon,
    rollback: s === "evaluated" || s === "canary" || s === "promoted",
  };
}

/** Latest run per variant (runs are ordered oldest → newest by the backend). */
export function latestRunsByVariant(runs: EvaluationRunOut[]): Map<string, EvaluationRunOut> {
  const out = new Map<string, EvaluationRunOut>();
  for (const r of runs) if (r.variant) out.set(r.variant, r);
  return out;
}

/** Variants whose latest run hasn't completed (decide is refused until this is empty). */
export function pendingVariants(exp: Pick<EvaluationExperimentOut, "variants">, runs: EvaluationRunOut[]): string[] {
  const latest = latestRunsByVariant(runs);
  return (exp.variants ?? [])
    .map((v) => (typeof v.name === "string" ? v.name : null))
    .filter((n): n is string => Boolean(n))
    .filter((n) => latest.get(n)?.status !== "completed");
}

export type StageState = "done" | "current" | "upcoming" | "failed" | "skipped";
export interface Stage {
  id: "draft" | "running" | "decided" | "canary" | "promoted";
  label: string;
  state: StageState;
}

const ORDER = ["draft", "running", "decided", "canary", "promoted"] as const;
const LABELS: Record<Stage["id"], string> = {
  draft: "Draft",
  running: "Evaluate",
  decided: "Decide",
  canary: "Canary",
  promoted: "Promote",
};

export function experimentStages(exp: Pick<EvaluationExperimentOut, "status" | "approved_at">): Stage[] {
  const s = exp.status;
  const idx: Record<string, number> = { draft: 0, running: 1, evaluated: 2, rejected: 2, canary: 3, promoted: 4 };
  let reached = idx[s] ?? 0;
  // A rollback resets rollout_percentage to 0; approved_at tells us whether a rollout had started.
  if (s === "rolled_back") reached = exp.approved_at ? 3 : 2;
  return ORDER.map((id, i) => {
    let state: StageState;
    if (s === "rejected") state = i < 2 ? "done" : i === 2 ? "failed" : "skipped";
    else if (s === "rolled_back") state = i < reached ? "done" : i === reached ? "failed" : "skipped";
    else if (s === "promoted") state = "done";
    else state = i < reached ? "done" : i === reached ? "current" : "upcoming";
    return { id, label: LABELS[id], state };
  });
}
