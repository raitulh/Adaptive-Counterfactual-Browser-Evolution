/**
 * ACBE pipeline state (pure, unit-tested).
 *
 *   Failure → Analysis → Candidate strategy → Evaluation → Canary → Promotion   (→ Rollback)
 *
 * Mapped from real backend state (app/acbe/service.py + experiments.py):
 *   draft       candidate proposed from a significant failure pattern; evaluation not started/finished
 *   evaluating  baseline-vs-candidate experiment running on the evaluation worker
 *   passed      promotion gate passed; waiting for a human to approve a canary
 *   rejected    promotion gate failed (terminal)
 *   canary      a human approved a bounded rollout; being observed
 *   promoted    live for every task in scope
 *   rolled_back taken out of service (from passed, canary or promoted)
 *   retired     superseded
 * Candidates created from a generic experiment (failure_type "experiment") skip failure analysis.
 */
import type { CandidateOut, FailurePatternOut } from "@/lib/api";

export const PIPELINE_STAGES = ["failure", "analysis", "candidate", "evaluation", "canary", "promotion"] as const;
export type PipelineStageId = (typeof PIPELINE_STAGES)[number];

export const STAGE_LABEL: Record<PipelineStageId, string> = {
  failure: "Failure",
  analysis: "Analysis",
  candidate: "Candidate strategy",
  evaluation: "Evaluation",
  canary: "Canary",
  promotion: "Promotion",
};

export type StageStatus = "done" | "active" | "waiting" | "failed" | "pending" | "skipped" | "rolled_back";

export interface CandidatePipeline {
  stages: Record<PipelineStageId, StageStatus>;
  /** The stage the candidate is at (or stopped at). */
  current: PipelineStageId;
  rolledBack: boolean;
  /** For rolled-back candidates: the stage it was in when it was rolled back. */
  rolledBackFrom: PipelineStageId | null;
  /** A person must act next (approve a canary, or decide on promotion). */
  needsHuman: boolean;
  summary: string;
}

type CandidateLike = Pick<CandidateOut, "status" | "failure_type" | "approved_at" | "promoted_at">;

function fill(current: number, currentStatus: StageStatus, after: StageStatus): Record<PipelineStageId, StageStatus> {
  return Object.fromEntries(
    PIPELINE_STAGES.map((s, i) => [s, i < current ? "done" : i === current ? currentStatus : after]),
  ) as Record<PipelineStageId, StageStatus>;
}

export function candidatePipeline(c: CandidateLike): CandidatePipeline {
  const fromExperiment = c.failure_type === "experiment";
  let result: CandidatePipeline;
  switch (c.status) {
    case "draft":
      result = {
        stages: fill(2, "active", "pending"),
        current: "candidate",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: "Proposed — waiting to be evaluated against the current strategy.",
      };
      break;
    case "evaluating":
      result = {
        stages: fill(3, "active", "pending"),
        current: "evaluation",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: "Being evaluated: baseline vs candidate on targeted and regression cases.",
      };
      break;
    case "passed":
      result = {
        stages: fill(4, "waiting", "pending"),
        current: "canary",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: true,
        summary: "Passed the promotion gate. Approve a canary to try it on a share of real tasks.",
      };
      break;
    case "rejected":
      result = {
        stages: fill(3, "failed", "skipped"),
        current: "evaluation",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: "Rejected by the promotion gate. It never reached real tasks.",
      };
      break;
    case "canary":
      result = {
        stages: fill(4, "active", "pending"),
        current: "canary",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: true,
        summary: "Serving a share of real tasks. Promote after the observation period, or roll back.",
      };
      break;
    case "promoted":
      result = {
        stages: fill(5, "done", "done"),
        current: "promotion",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: "Promoted — live for every task in its scope. It can still be rolled back.",
      };
      break;
    case "retired":
      result = {
        stages: fill(5, "done", "done"),
        current: "promotion",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: "Retired — superseded and no longer used.",
      };
      break;
    case "rolled_back": {
      const from: PipelineStageId = c.promoted_at ? "promotion" : c.approved_at ? "canary" : "evaluation";
      const idx = PIPELINE_STAGES.indexOf(from);
      result = {
        stages: fill(idx, "rolled_back", "skipped"),
        current: from,
        rolledBack: true,
        rolledBackFrom: from,
        needsHuman: false,
        summary:
          from === "promotion"
            ? "Rolled back after promotion. Tasks use the previous strategy again."
            : from === "canary"
              ? "Rolled back during its canary. Tasks use the previous strategy again."
              : "Withdrawn after passing evaluation, before any rollout.",
      };
      break;
    }
    default:
      result = {
        stages: fill(2, "pending", "pending"),
        current: "candidate",
        rolledBack: false,
        rolledBackFrom: null,
        needsHuman: false,
        summary: `Status “${c.status}”.`,
      };
  }
  if (fromExperiment) {
    result.stages = { ...result.stages, failure: "skipped", analysis: "skipped" };
  }
  return result;
}

/** Which actions the backend accepts for a candidate in this status (it still re-checks). */
export function candidateActions(status: string) {
  return {
    evaluate: status === "draft" || status === "evaluating",
    canary: status === "passed" || status === "canary",
    promote: status === "canary",
    rollback: status === "passed" || status === "canary" || status === "promoted",
  };
}

// ------------------------------------------------------------------------------------ overview
export interface StageCount {
  stage: PipelineStageId | "rollback";
  count: number;
  /** Secondary count shown under the stage (e.g. rejected, awaiting approval). */
  detail: string | null;
  tone: "neutral" | "accent" | "warning" | "danger" | "success" | "verify" | "recover";
}

export function pipelineOverview(
  failures: Pick<FailurePatternOut, "significant" | "learnable" | "occurrences">[],
  candidates: Pick<CandidateOut, "status">[],
): StageCount[] {
  const by = (s: string) => candidates.filter((c) => c.status === s).length;
  const occurrences = failures.reduce((n, f) => n + (f.occurrences || 0), 0);
  const learnable = failures.filter((f) => f.significant && f.learnable).length;
  const passed = by("passed");
  return [
    {
      stage: "failure",
      count: failures.length,
      detail: failures.length ? `${occurrences} verified failure${occurrences === 1 ? "" : "s"}` : null,
      tone: failures.length ? "danger" : "neutral",
    },
    {
      stage: "analysis",
      count: learnable,
      detail: failures.length ? `${failures.length - learnable} not actionable` : null,
      tone: learnable ? "verify" : "neutral",
    },
    { stage: "candidate", count: by("draft"), detail: null, tone: by("draft") ? "neutral" : "neutral" },
    {
      stage: "evaluation",
      count: by("evaluating"),
      detail: by("rejected") ? `${by("rejected")} rejected` : null,
      tone: by("evaluating") ? "verify" : "neutral",
    },
    {
      stage: "canary",
      count: by("canary") + passed,
      detail: passed ? `${passed} awaiting approval` : null,
      tone: passed ? "warning" : by("canary") ? "accent" : "neutral",
    },
    {
      stage: "promotion",
      count: by("promoted"),
      detail: by("retired") ? `${by("retired")} retired` : null,
      tone: by("promoted") ? "success" : "neutral",
    },
    { stage: "rollback", count: by("rolled_back"), detail: null, tone: by("rolled_back") ? "recover" : "neutral" },
  ];
}
