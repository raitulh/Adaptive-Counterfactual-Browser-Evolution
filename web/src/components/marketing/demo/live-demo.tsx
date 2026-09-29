"use client";

/**
 * Interactive, simulated run of a real AgentOS workflow. The view renders the product's own
 * presentational task components (timeline, live activity, plan graph) from a `TaskEventSource`;
 * the simulated source plays a deterministic script in the browser — no request is made and no
 * account is touched. A live, authenticated source can replace it without changing this view.
 */
import { CheckCircle2Icon, FlaskConicalIcon, PlayIcon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { buildTimeline, LiveActivity, PlanGraph, TaskTimeline } from "@/components/tasks/timeline";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DEMO_PHASES,
  derivePhase,
  SimulatedTaskEventSource,
  type DemoPhase,
  type TaskEventSource,
  type TaskRunSnapshot,
} from "@/lib/demo/task-event-source";
import { cn } from "@/lib/utils";
import { DemoApprovalCard } from "./demo-approval";

function PhaseRail({ snapshot }: { snapshot: TaskRunSnapshot }) {
  const phase = derivePhase(snapshot);
  const failedAt: DemoPhase | null =
    phase === "failed"
      ? snapshot.steps.find((s) => s.step_key === "send_confirmation")?.status === "failed"
        ? "gmail_confirmation"
        : "approval"
      : null;
  const currentId = failedAt ?? phase;
  const currentIndex = DEMO_PHASES.findIndex((p) => p.id === currentId);
  const waiting = Boolean(snapshot.pendingApproval);

  return (
    <ol className="flex [scrollbar-width:none] gap-1 overflow-x-auto px-4 py-3 sm:px-5" aria-label="Run progress">
      {DEMO_PHASES.map((p, i) => {
        const done = currentIndex > i || phase === "completed";
        const current = i === currentIndex && phase !== "completed";
        const tone =
          failedAt && current ? "danger" : current && waiting ? "warning" : current ? "accent" : done ? "done" : "idle";
        return (
          <li key={p.id} className="flex shrink-0 items-center gap-1" aria-current={current ? "step" : undefined}>
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] whitespace-nowrap transition-colors duration-300",
                tone === "accent" && "border-accent/40 bg-accent/10 text-accent",
                tone === "warning" && "border-warning/40 bg-warning/10 text-warning",
                tone === "danger" && "border-danger/40 bg-danger/10 text-danger",
                tone === "done" &&
                  (p.id === "completed" ? "border-success/35 bg-success/10 text-success" : "border-line text-fg-muted"),
                tone === "idle" && "border-transparent text-fg-subtle",
              )}
            >
              {tone === "done" && (
                <CheckCircle2Icon
                  className={cn("size-3", p.id === "completed" ? "text-success" : "text-fg-subtle")}
                  aria-hidden
                />
              )}
              {(tone === "accent" || tone === "warning") && (
                <span
                  className={cn(
                    "size-1.5 rounded-full motion-safe:animate-signal",
                    tone === "warning" ? "bg-warning" : "bg-accent",
                  )}
                  aria-hidden
                />
              )}
              {tone === "danger" && <XCircleIcon className="size-3" aria-hidden />}
              {p.label}
            </span>
            {i < DEMO_PHASES.length - 1 && <span className="h-px w-2.5 bg-line-strong" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function RunSummary({ snapshot }: { snapshot: TaskRunSnapshot }) {
  const changed = snapshot.steps.filter((s) => s.external_ref && s.status === "completed");
  const verified = snapshot.steps.filter((s) => s.verification_status === "passed");
  const completed = snapshot.task.status === "completed";
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-4",
        completed ? "border-success/30 bg-success/[0.04]" : "border-danger/30 bg-danger/[0.04]",
      )}
    >
      <div>
        <p className={cn("text-[13px] font-semibold", completed ? "text-success" : "text-danger")}>
          {completed ? "Done — every step verified" : "Stopped — nothing was claimed that didn't happen"}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-fg-muted">
          {completed
            ? "The task completed only after the final check: all steps passed verification and no external action was left unconfirmed."
            : "The rejected action never ran; the steps that depended on it were skipped. The summary reports exactly what changed."}
        </p>
      </div>
      <dl className="grid grid-cols-1 gap-3 border-t border-line pt-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[10px] tracking-[0.16em] text-fg-subtle uppercase">What changed</dt>
          <dd className="mt-1.5 flex flex-col gap-1 text-fg-muted">
            {changed.length === 0 ? (
              <span>Nothing</span>
            ) : (
              changed.map((s) => <span key={s.id}>{s.output_summary}</span>)
            )}
          </dd>
        </div>
        <div>
          <dt className="font-mono text-[10px] tracking-[0.16em] text-fg-subtle uppercase">Verified</dt>
          <dd className="mt-1.5 flex flex-col gap-1 font-mono text-[11px] text-verify">
            {verified.map((s) => (
              <span key={s.id}>
                {s.step_key} · {s.verification_method === "provider_confirmation" ? "read_back" : s.verification_method}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function LiveDemo({ className }: { className?: string }) {
  const [source] = useState<TaskEventSource>(() => new SimulatedTaskEventSource());
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [deciding, setDeciding] = useState<{ id: string; kind: "approve" | "reject" } | null>(null);
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const autoStarted = useRef(false);

  // Stop timers when the section unmounts (reset keeps the source reusable under StrictMode).
  useEffect(() => () => source.reset(), [source]);

  // Start once when the demo scrolls into view (explicit button otherwise; never under reduced motion).
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !autoStarted.current) {
          autoStarted.current = true;
          source.start();
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [source, reduced]);

  // Keep the newest events in view inside the timeline (never scrolls the page).
  const count = snapshot.events.length;
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [count, reduced]);

  const { current } = useMemo(
    () => buildTimeline(snapshot.events, { steps: snapshot.steps, taskStatus: snapshot.task.status }),
    [snapshot.events, snapshot.steps, snapshot.task.status],
  );

  const started = snapshot.events.length > 0;
  const pending = snapshot.pendingApproval;
  const decidingKind = deciding && pending && deciding.id === pending.id ? deciding.kind : null;

  const decide = (kind: "approve" | "reject") => {
    if (!pending || decidingKind) return;
    setDeciding({ id: pending.id, kind });
    const action = kind === "approve" ? source.approve(pending.id) : source.reject(pending.id);
    action.catch(() => setDeciding(null));
  };

  const replay = () => {
    setDeciding(null);
    source.reset();
    source.start();
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <div className="overflow-hidden rounded-2xl border border-line-strong bg-surface-1/90 shadow-float backdrop-blur-sm">
        {/* Task header */}
        <div className="flex flex-col gap-3 border-b border-line px-4 py-4 sm:flex-row sm:items-start sm:px-5">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">
              Task
              <span className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-2 py-0.5 tracking-normal text-fg-muted normal-case">
                <FlaskConicalIcon className="size-3" aria-hidden />
                Simulated run — no real accounts are touched
              </span>
            </p>
            <p className="mt-2 text-[15px] leading-snug font-medium text-fg sm:text-base">{snapshot.task.goal}</p>
            {snapshot.task.context && <p className="mt-1 text-xs text-fg-subtle">Context: {snapshot.task.context}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {started ? (
              <StatusBadge kind="task" value={snapshot.task.status} size="md" />
            ) : (
              <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-fg-subtle">Ready</span>
            )}
            {snapshot.finished && (
              <Button variant="outline" size="sm" onClick={replay}>
                <RotateCcwIcon aria-hidden />
                Replay
              </Button>
            )}
          </div>
        </div>
        <div className="border-b border-line">
          <PhaseRail snapshot={snapshot} />
        </div>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]">
          {/* Left: what is happening, what needs you, the plan */}
          <div className="flex flex-col gap-4 border-line p-4 sm:p-5 lg:border-r">
            {!started ? (
              <div className="flex flex-col items-start gap-3 rounded-xl border border-dashed border-line-strong p-5">
                <p className="text-sm text-fg-muted">
                  Run the goal through the real lifecycle: planning, policy, parallel reads, approvals you decide,
                  writes, read-back verification and a final check.
                </p>
                <Button variant="primary" onClick={() => source.start()}>
                  <PlayIcon aria-hidden />
                  Run simulation
                </Button>
              </div>
            ) : (
              <LiveActivity current={current} status={snapshot.task.status} />
            )}
            {pending && (
              <DemoApprovalCard
                key={pending.id}
                approval={pending}
                deciding={decidingKind}
                onApprove={() => decide("approve")}
                onReject={() => decide("reject")}
              />
            )}
            {snapshot.finished && <RunSummary snapshot={snapshot} />}
            {started && (
              <div>
                <h3 className="mb-2 font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">
                  Execution graph
                </h3>
                <PlanGraph
                  plan={snapshot.task.plan}
                  steps={snapshot.steps}
                  planVersion={snapshot.task.plan_version}
                  taskStatus={snapshot.task.status}
                  goal={snapshot.task.goal}
                />
              </div>
            )}
          </div>

          {/* Right: the durable event timeline */}
          <div className="flex min-h-0 flex-col border-t border-line lg:border-t-0">
            <div className="flex items-center justify-between px-4 pt-4 sm:px-5">
              <h3 className="font-mono text-[10.5px] tracking-[0.18em] text-fg-subtle uppercase">Timeline</h3>
              <span className="font-mono text-[10.5px] text-fg-subtle" aria-live="off">
                {snapshot.events.length} events
              </span>
            </div>
            <div
              ref={scroller}
              className="max-h-[560px] min-h-[320px] flex-1 overflow-y-auto px-4 pt-3 pb-5 sm:px-5 lg:max-h-[720px]"
            >
              <TaskTimeline
                events={snapshot.events}
                steps={snapshot.steps}
                taskStatus={snapshot.task.status}
                animate={!reduced}
                empty={
                  <p className="rounded-xl border border-dashed border-line p-5 text-sm text-fg-subtle">
                    Events appear here as the run progresses — the same ordered, durable log the product streams for
                    every task.
                  </p>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
