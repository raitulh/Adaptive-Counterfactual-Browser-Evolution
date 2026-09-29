"use client";

import {
  BugIcon,
  DnaIcon,
  FlaskConicalIcon,
  RadioTowerIcon,
  RocketIcon,
  ScanSearchIcon,
  UndoDotIcon,
  type LucideIcon,
} from "lucide-react";
import { toneClasses } from "@/lib/status";
import { cn } from "@/lib/utils";
import {
  PIPELINE_STAGES,
  STAGE_LABEL,
  type CandidatePipeline,
  type PipelineStageId,
  type StageCount,
  type StageStatus,
} from "./pipeline-state";

export const STAGE_ICON: Record<PipelineStageId | "rollback", LucideIcon> = {
  failure: BugIcon,
  analysis: ScanSearchIcon,
  candidate: DnaIcon,
  evaluation: FlaskConicalIcon,
  canary: RadioTowerIcon,
  promotion: RocketIcon,
  rollback: UndoDotIcon,
};

const STAGE_HINT: Record<PipelineStageId | "rollback", string> = {
  failure: "Verified task failures, fingerprinted",
  analysis: "Significant, learnable patterns",
  candidate: "Proposed strategy changes (config only)",
  evaluation: "Baseline vs candidate + safety gates",
  canary: "Human-approved partial rollout",
  promotion: "Live for every task in scope",
  rollback: "Taken out of service",
};

function Connector({ active }: { active: boolean }) {
  return (
    <svg
      className="hidden h-3 w-full min-w-4 shrink text-line-strong lg:block"
      viewBox="0 0 40 12"
      preserveAspectRatio="none"
      aria-hidden
    >
      <line
        x1="0"
        y1="6"
        x2="34"
        y2="6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray={active ? "4 4" : undefined}
        className={cn(active && "text-accent motion-safe:animate-dash")}
      />
      <path
        d="M33 2 L39 6 L33 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={cn(active && "text-accent")}
      />
    </svg>
  );
}

/** Organization-wide flow: how many patterns/candidates sit in each stage right now. */
export function PipelineOverview({ counts }: { counts: StageCount[] }) {
  const main = counts.filter((c) => c.stage !== "rollback");
  const rollback = counts.find((c) => c.stage === "rollback");
  return (
    <div className="flex flex-col gap-3">
      <ol
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:items-stretch lg:gap-0"
        aria-label="ACBE pipeline stages"
      >
        {main.map((c, i) => {
          const Icon = STAGE_ICON[c.stage];
          const t = toneClasses[c.tone];
          const next = main[i + 1];
          return (
            <li key={c.stage} className="flex min-w-0 items-center lg:flex-1">
              <div
                className={cn(
                  "flex h-full min-w-0 flex-1 flex-col gap-2 rounded-xl border bg-surface-1 p-3",
                  c.count > 0 ? t.border : "border-line",
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg",
                      c.count > 0 ? [t.soft, t.text] : "bg-white/[0.04] text-fg-subtle",
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <span className="truncate text-xs font-medium text-fg">
                    {c.stage === "candidate" ? "Candidate" : STAGE_LABEL[c.stage as PipelineStageId]}
                  </span>
                </div>
                <div className="font-mono text-2xl font-semibold tracking-tight text-fg tabular-nums">{c.count}</div>
                <div className="min-h-8 text-2xs leading-snug text-fg-subtle">{c.detail ?? STAGE_HINT[c.stage]}</div>
              </div>
              {next && (
                <div className="hidden w-8 shrink-0 lg:block">
                  <Connector active={next.count > 0} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {rollback && (
        <div className="flex flex-col gap-2 lg:ml-[50%] lg:pl-4">
          <div className="hidden items-center gap-2 text-2xs text-fg-subtle lg:flex" aria-hidden>
            <span className="h-4 w-px bg-recover/40" />
            <span>from canary or promotion, at any time</span>
          </div>
          <div
            className={cn(
              "flex items-center gap-3 rounded-xl border border-dashed bg-surface-1 px-3 py-2.5",
              rollback.count ? "border-recover/40" : "border-line-strong",
            )}
          >
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg",
                rollback.count ? "bg-recover/10 text-recover" : "bg-white/[0.04] text-fg-subtle",
              )}
            >
              <UndoDotIcon className="size-3.5" aria-hidden />
            </span>
            <span className="text-xs font-medium text-fg">Rollback</span>
            <span className="font-mono text-lg font-semibold text-fg tabular-nums">{rollback.count}</span>
            <span className="text-2xs text-fg-subtle">{STAGE_HINT.rollback}; takes effect immediately</span>
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_STYLE: Record<StageStatus, { ring: string; label: string; text: string }> = {
  done: { ring: "border-success/40 bg-success/10 text-success", label: "done", text: "text-fg-muted" },
  active: {
    ring: "border-accent/60 bg-accent/15 text-accent shadow-[0_0_0_3px_rgb(92_225_230/0.12)]",
    label: "in progress",
    text: "text-fg",
  },
  waiting: {
    ring: "border-warning/60 bg-warning/15 text-warning shadow-[0_0_0_3px_rgb(245_184_74/0.12)]",
    label: "needs a decision",
    text: "text-fg",
  },
  failed: { ring: "border-danger/50 bg-danger/15 text-danger", label: "stopped here", text: "text-danger" },
  pending: { ring: "border-line-strong text-fg-subtle", label: "not yet", text: "text-fg-subtle" },
  skipped: {
    ring: "border-dashed border-line-strong text-fg-subtle/60",
    label: "not reached",
    text: "text-fg-subtle/70",
  },
  rolled_back: { ring: "border-recover/60 bg-recover/15 text-recover", label: "rolled back", text: "text-recover" },
};

/** One candidate's position in the pipeline (icon + text per stage; never color alone). */
export function CandidatePipelineView({ pipeline }: { pipeline: CandidatePipeline }) {
  return (
    <div className="flex flex-col gap-3">
      <ol className="grid grid-cols-3 gap-y-4 sm:grid-cols-6" aria-label="Candidate progress through the ACBE pipeline">
        {PIPELINE_STAGES.map((stage, i) => {
          const status = pipeline.stages[stage];
          const style = STATUS_STYLE[status];
          const Icon = STAGE_ICON[stage];
          return (
            <li
              key={stage}
              className="relative flex flex-col items-center gap-2 text-center"
              aria-current={pipeline.current === stage ? "step" : undefined}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-4 hidden sm:block",
                    status === "skipped" || status === "pending" ? "border-t border-dashed border-line-strong" : "h-px",
                    status === "done"
                      ? "bg-success/40"
                      : status === "active" || status === "waiting"
                        ? "bg-accent/40"
                        : status === "rolled_back"
                          ? "bg-recover/40"
                          : status === "failed"
                            ? "bg-danger/40"
                            : "",
                  )}
                  style={{ left: "calc(-50% + 1.25rem)", right: "calc(50% + 1.25rem)" }}
                />
              )}
              <span
                className={cn(
                  "relative z-[1] flex size-8 items-center justify-center rounded-full border",
                  style.ring,
                  status === "active" && "motion-safe:animate-pulse",
                )}
              >
                {status === "rolled_back" ? (
                  <UndoDotIcon className="size-3.5" aria-hidden />
                ) : (
                  <Icon className="size-3.5" aria-hidden />
                )}
              </span>
              <span className={cn("text-2xs leading-tight font-medium", style.text)}>{STAGE_LABEL[stage]}</span>
              <span className="text-2xs leading-tight text-fg-subtle">{style.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
