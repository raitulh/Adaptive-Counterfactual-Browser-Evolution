"use client";

/**
 * Vertical execution graph: Goal → Plan → steps (by dependency level; parallel steps side by side
 * with fork/join connectors) → Verification → Result, reflecting live step status.
 * Pure: pass the stored plan, the step rows and the task status.
 */
import { CheckIcon, FlagIcon, HandIcon, ListTreeIcon, ShieldCheckIcon, SplitIcon, XIcon } from "lucide-react";
import * as React from "react";
import type { StepStatus, TaskStatus } from "@/lib/api";
import { humanizeTool } from "@/lib/format";
import { stepStatusMeta, taskStatusMeta, toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { buildPlanGraph, type PlanGraphModel, type PlanGraphNode, type PlanGraphStep } from "./plan-graph-model";
import { toolIcon } from "./tool-meta";

export interface PlanGraphProps {
  /** `task.plan` as stored by the planner (may be null before planning finishes). */
  plan: Record<string, unknown> | null | undefined;
  /** Step rows (any plan version; only `planVersion` is drawn). */
  steps: readonly PlanGraphStep[];
  planVersion: number;
  taskStatus: TaskStatus;
  /** The task goal (shown in the Goal node when the plan has none yet). */
  goal?: string;
  /** Called with a step id when a step node is activated. */
  onSelectStep?: (stepId: string) => void;
  className?: string;
}

type NodeState = "pending" | "active" | "waiting" | "verify" | "done" | "verified" | "failed" | "recover" | "skipped";

function stepNodeState(status: StepStatus | null, verification: PlanGraphNode["verification"]): NodeState {
  switch (status) {
    case null:
    case "pending":
      return "pending";
    case "running":
    case "waiting_external":
      return "active";
    case "verifying":
      return "verify";
    case "waiting_approval":
    case "waiting_input":
      return "waiting";
    case "completed":
      return verification === "passed" ? "verified" : "done";
    case "failed":
    case "blocked":
      return "failed";
    case "retry_scheduled":
    case "requires_reconciliation":
      return "recover";
    default:
      return "skipped";
  }
}

const STATE_TONE: Record<NodeState, Tone> = {
  pending: "neutral",
  active: "accent",
  waiting: "warning",
  verify: "verify",
  done: "success",
  verified: "verify",
  failed: "danger",
  recover: "recover",
  skipped: "neutral",
};

function Marker({ state }: { state: NodeState }) {
  const t = toneClasses[STATE_TONE[state]];
  if (state === "verified") return <ShieldCheckIcon className={cn("size-3.5", t.text)} aria-hidden />;
  if (state === "done") return <CheckIcon className={cn("size-3.5", t.text)} aria-hidden />;
  if (state === "failed") return <XIcon className={cn("size-3.5", t.text)} aria-hidden />;
  if (state === "waiting") return <HandIcon className={cn("size-3.5", t.text)} aria-hidden />;
  return (
    <span className="relative inline-flex size-2" aria-hidden>
      {(state === "active" || state === "verify") && (
        <span className={cn("absolute inset-0 rounded-full motion-safe:animate-pulse-ring", t.dot)} />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          state === "pending" || state === "skipped" ? "border border-fg-subtle" : t.dot,
        )}
      />
    </span>
  );
}

function FrameNode({
  icon: Icon,
  label,
  title,
  sub,
  state,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  state: NodeState;
}) {
  const t = toneClasses[STATE_TONE[state]];
  return (
    <div
      className={cn(
        "relative flex items-start gap-2.5 rounded-lg border bg-surface-1 px-3 py-2",
        state === "pending" ? "border-dashed border-line-strong" : t.border,
        state === "verify" && "ring-1 ring-verify/40",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
          state === "pending" ? "bg-white/5 text-fg-subtle" : [t.soft, t.text],
        )}
      >
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-2xs font-semibold tracking-[0.12em] text-fg-subtle uppercase">{label}</span>
          <span className="ml-auto">
            <Marker state={state} />
          </span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-fg">{title}</div>
        {sub && <div className="mt-0.5 text-2xs text-fg-muted">{sub}</div>}
      </div>
    </div>
  );
}

function StepNode({ node, onSelect }: { node: PlanGraphNode; onSelect?: (id: string) => void }) {
  const state = stepNodeState(node.status, node.verification);
  const t = toneClasses[STATE_TONE[state]];
  const statusLabel = node.status ? stepStatusMeta[node.status].label : "Planned";
  const content = (
    <>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded",
            state === "pending" ? "bg-white/5 text-fg-subtle" : [t.soft, t.text],
          )}
        >
          {React.createElement(toolIcon(node.tool), { className: "size-3", "aria-hidden": true })}
        </span>
        <span className="font-mono text-2xs text-fg-subtle">{node.position + 1}</span>
        {node.requiresApproval && <HandIcon className="size-3 text-warning" aria-label="Requires approval" />}
        <span className="ml-auto">
          <Marker state={state} />
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-left text-[12.5px] leading-snug text-fg">{node.label}</p>
      <p className={cn("mt-0.5 truncate text-left text-2xs", state === "pending" ? "text-fg-subtle" : t.text)}>
        {statusLabel}
        <span className="text-fg-subtle"> · {humanizeTool(node.tool)}</span>
      </p>
    </>
  );
  const cls = cn(
    "relative block w-full min-w-0 rounded-lg border bg-surface-1 px-2.5 py-2 text-left outline-none transition-colors",
    state === "pending" || state === "skipped" ? "border-dashed border-line-strong" : t.border,
    state === "skipped" && "opacity-60",
    state === "verify" && "ring-1 ring-verify/45",
    state === "waiting" && "shadow-[0_0_18px_-6px_rgb(245_184_74/0.5)]",
    onSelect && node.stepId && "hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50",
  );
  if (onSelect && node.stepId) {
    return (
      <button
        type="button"
        className={cls}
        onClick={() => onSelect(node.stepId!)}
        aria-label={`Step ${node.position + 1}: ${node.label} — ${statusLabel}`}
      >
        {content}
      </button>
    );
  }
  return (
    <div className={cls} aria-label={`Step ${node.position + 1}: ${node.label} — ${statusLabel}`}>
      {content}
    </div>
  );
}

function centers(count: number): number[] {
  const cols = Math.min(count, 2);
  return cols === 1 ? [50] : [25, 75];
}

/** Fork/join connector between two rows (percent coordinates, non-scaling strokes). */
function Connector({ from, to, done }: { from: number; to: number; done: boolean }) {
  const a = centers(from);
  const b = centers(to);
  const stroke = done ? "stroke-accent/50" : "stroke-white/15";
  const dash = done ? undefined : "3 3";
  const busNeeded = a.length > 1 || b.length > 1;
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-5 w-full" aria-hidden>
      {a.map((x) => (
        <line
          key={`a${x}`}
          x1={x}
          y1={0}
          x2={x}
          y2={busNeeded ? 10 : 20}
          className={stroke}
          strokeWidth={1.25}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {busNeeded && (
        <line
          x1={Math.min(...a, ...b)}
          y1={10}
          x2={Math.max(...a, ...b)}
          y2={10}
          className={stroke}
          strokeWidth={1.25}
          strokeDasharray={dash}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {busNeeded &&
        b.map((x) => (
          <line
            key={`b${x}`}
            x1={x}
            y1={10}
            x2={x}
            y2={20}
            className={stroke}
            strokeWidth={1.25}
            strokeDasharray={dash}
            vectorEffect="non-scaling-stroke"
          />
        ))}
    </svg>
  );
}

function Level({ nodes, onSelect }: { nodes: PlanGraphNode[]; onSelect?: (id: string) => void }) {
  return (
    <div className="relative">
      {nodes.length > 1 && (
        <span className="absolute -top-2.5 left-1/2 z-10 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-surface-2 px-1.5 text-[10px] text-fg-subtle">
          <SplitIcon className="size-2.5 rotate-180" aria-hidden /> in parallel
        </span>
      )}
      <div className={cn("grid gap-2", nodes.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
        {nodes.map((n) => (
          <StepNode key={n.key} node={n} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

export function PlanGraph({ plan, steps, planVersion, taskStatus, goal, onSelectStep, className }: PlanGraphProps) {
  const model: PlanGraphModel = React.useMemo(
    () => buildPlanGraph({ plan, steps, planVersion }),
    [plan, steps, planVersion],
  );
  const status = taskStatusMeta[taskStatus];
  const planning = ["created", "planning"].includes(taskStatus) && planVersion === 0;
  const planFailed = planVersion === 0 && (taskStatus === "failed" || taskStatus === "blocked");
  const planState: NodeState = planning
    ? "active"
    : planFailed
      ? "failed"
      : planVersion === 0 && taskStatus === "waiting_input"
        ? "waiting"
        : planVersion > 0
          ? "done"
          : "pending";
  const verified = model.nodes.filter((n) => n.verification === "passed").length;
  const verifyState: NodeState =
    taskStatus === "verifying"
      ? "verify"
      : taskStatus === "completed"
        ? "verified"
        : model.nodes.some((n) => n.status === "requires_reconciliation")
          ? "recover"
          : verified > 0
            ? "verify"
            : "pending";
  const resultState: NodeState =
    taskStatus === "completed"
      ? "done"
      : status.tone === "danger"
        ? "failed"
        : status.attention
          ? "waiting"
          : taskStatus === "cancelled" || taskStatus === "expired"
            ? "skipped"
            : "pending";
  const levelDone = (l: PlanGraphNode[]) => l.length > 0 && l.every((n) => n.status === "completed");

  return (
    <div className={cn("flex flex-col", className)} aria-label="Execution graph">
      <FrameNode icon={FlagIcon} label="Goal" title={model.goal ?? goal ?? "—"} state="done" />
      <Connector from={1} to={1} done={planVersion > 0} />
      <FrameNode
        icon={ListTreeIcon}
        label="Plan"
        title={
          planning
            ? "Drafting a plan…"
            : (model.summary ??
              (model.directResponse
                ? "Answer directly — no actions needed"
                : planVersion > 0
                  ? `${model.nodes.length} steps`
                  : "Not planned yet"))
        }
        sub={
          planVersion > 0
            ? `Version ${planVersion} · ${model.nodes.length} step${model.nodes.length === 1 ? "" : "s"}${model.parallel ? " · parallel branches" : ""}`
            : null
        }
        state={planState}
      />
      {model.levels.map((level, i) => (
        <React.Fragment key={i}>
          <Connector
            from={i === 0 ? 1 : model.levels[i - 1].length}
            to={level.length}
            done={i === 0 ? level.some((n) => n.status && n.status !== "pending") : levelDone(model.levels[i - 1])}
          />
          <Level nodes={level} onSelect={onSelectStep} />
        </React.Fragment>
      ))}
      <Connector
        from={model.levels.at(-1)?.length ?? 1}
        to={1}
        done={
          model.levels.length === 0 ? planVersion > 0 && taskStatus !== "planning" : levelDone(model.levels.at(-1)!)
        }
      />
      <FrameNode
        icon={ShieldCheckIcon}
        label="Verification"
        title={
          model.nodes.length === 0
            ? model.directResponse
              ? "Direct answer — not externally verified"
              : "Nothing to verify yet"
            : `${verified} of ${model.nodes.length} results verified`
        }
        state={verifyState}
      />
      <Connector from={1} to={1} done={taskStatus === "completed"} />
      <FrameNode icon={CheckIcon} label="Result" title={status.label} sub={status.description} state={resultState} />
    </div>
  );
}
