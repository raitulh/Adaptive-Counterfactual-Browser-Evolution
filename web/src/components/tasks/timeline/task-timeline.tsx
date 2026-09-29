"use client";

/**
 * The execution timeline: task events rendered semantically and grouped into phases
 * (Planning · Execution · Verification · Recovery · Approval · Result).
 *
 * Pure presentational component — pass events (sorted by `seq`), the task's steps and its status.
 * The authenticated app feeds it from `useTaskStream`; demos can feed it mock data.
 * Long histories are virtualized.
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import type { TaskEvent, TaskStatus } from "@/lib/api";
import { timelineItem } from "@/lib/motion";
import { toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";
import { buildTimeline, type TimelineEntry, type TimelinePhase, type TimelinePhaseGroup, type TimelineStep } from "./normalize";
import { TimelineRow } from "./timeline-row";

export interface TaskTimelineProps {
  /** Task events, any order (they are sorted by `seq`). */
  events: readonly TaskEvent[];
  /** Steps of the task (names steps in sentences). */
  steps?: readonly TimelineStep[];
  /** Current task status (stops "in progress" animations once no worker drives the task). */
  taskStatus?: TaskStatus;
  /** Show raw event payloads per entry ("Advanced event data"). */
  developerMode?: boolean;
  /** Include bookkeeping status changes that are implied by other events. */
  showAllEvents?: boolean;
  /** Virtualize beyond this many entries (default 150). */
  virtualizeAfter?: number;
  /** Height of the scroll viewport when virtualized (CSS length, default "70vh"). */
  virtualHeight?: string;
  /** Rendered when there are no events yet. */
  empty?: React.ReactNode;
  /** Animate entries that arrive after the first render (default true; honours reduced motion). */
  animate?: boolean;
  className?: string;
}

const PHASE_TONE: Record<TimelinePhase, Tone> = {
  planning: "accent",
  execution: "accent",
  verification: "verify",
  recovery: "recover",
  approval: "warning",
  outcome: "success",
};

function groupTone(group: TimelinePhaseGroup): Tone {
  if (group.phase === "outcome") {
    const last = group.entries[group.entries.length - 1];
    return last?.tone ?? "neutral";
  }
  return PHASE_TONE[group.phase];
}

export function PhaseHeader({ group }: { group: TimelinePhaseGroup }) {
  const tone = groupTone(group);
  const t = toneClasses[tone];
  const stateLabel = group.state === "active" ? "in progress" : group.state === "waiting" ? "waiting for you" : group.state === "failed" ? "with problems" : null;
  return (
    <div className="mb-2 flex items-center gap-2 pl-[5px]">
      <span className={cn("size-[18px] rounded-full border p-[4px]", t.border)} aria-hidden>
        <span className={cn("block size-full rounded-full", t.dot, group.state === "active" && "motion-safe:animate-signal")} />
      </span>
      <h3 className={cn("text-2xs font-semibold uppercase tracking-[0.14em]", t.text)}>{group.label}</h3>
      {stateLabel && <span className="text-2xs text-fg-subtle">· {stateLabel}</span>}
      <span className="h-px flex-1 bg-gradient-to-r from-line-strong to-transparent" aria-hidden />
    </div>
  );
}

function GroupList({
  group,
  isLastGroup,
  developerMode,
  animate,
}: {
  group: TimelinePhaseGroup;
  isLastGroup: boolean;
  developerMode: boolean;
  animate: boolean;
}) {
  return (
    <ol className="flex flex-col">
      <AnimatePresence initial={false}>
        {group.entries.map((entry, i) => {
          const connector = !(isLastGroup && i === group.entries.length - 1);
          return animate ? (
            <motion.li key={entry.key} variants={timelineItem} initial="hidden" animate="show" layout="position">
              <TimelineRow entry={entry} connector={connector} developerMode={developerMode} />
            </motion.li>
          ) : (
            <li key={entry.key}>
              <TimelineRow entry={entry} connector={connector} developerMode={developerMode} />
            </li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

type FlatRow = { kind: "header"; group: TimelinePhaseGroup } | { kind: "entry"; entry: TimelineEntry; connector: boolean };

function VirtualTimeline({ groups, developerMode, height }: { groups: TimelinePhaseGroup[]; developerMode: boolean; height: string }) {
  const rows = React.useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    groups.forEach((g, gi) => {
      out.push({ kind: "header", group: g });
      g.entries.forEach((entry, i) => out.push({ kind: "entry", entry, connector: !(gi === groups.length - 1 && i === g.entries.length - 1) }));
    });
    return out;
  }, [groups]);
  const parentRef = React.useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual is designed for this usage
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? 34 : 64),
    overscan: 12,
  });
  return (
    <div ref={parentRef} className="overflow-y-auto pr-1" style={{ maxHeight: height }} tabIndex={0} aria-label="Execution timeline (scrollable)">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index];
          return (
            <div
              key={row.kind === "header" ? row.group.key : row.entry.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${item.start}px)` }}
            >
              {row.kind === "header" ? (
                <div className="pt-1">
                  <PhaseHeader group={row.group} />
                </div>
              ) : (
                <TimelineRow entry={row.entry} connector={row.connector} developerMode={developerMode} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TaskTimeline({
  events,
  steps,
  taskStatus,
  developerMode = false,
  showAllEvents = false,
  virtualizeAfter = 150,
  virtualHeight = "70vh",
  empty,
  animate = true,
  className,
}: TaskTimelineProps) {
  const sorted = React.useMemo(() => [...events].sort((a, b) => a.seq - b.seq), [events]);
  const { entries, groups } = React.useMemo(
    () => buildTimeline(sorted, { steps, showAll: showAllEvents, taskStatus }),
    [sorted, steps, showAllEvents, taskStatus],
  );

  if (entries.length === 0) return <>{empty ?? null}</>;

  if (entries.length > virtualizeAfter) {
    return (
      <div className={className}>
        <VirtualTimeline groups={groups} developerMode={developerMode} height={virtualHeight} />
      </div>
    );
  }

  return (
    <ol className={cn("flex flex-col gap-1", className)} aria-label="Execution timeline">
      {groups.map((group, gi) => (
        <li key={group.key} aria-label={`${group.label} phase`}>
          <PhaseHeader group={group} />
          <GroupList group={group} isLastGroup={gi === groups.length - 1} developerMode={developerMode} animate={animate} />
        </li>
      ))}
    </ol>
  );
}
