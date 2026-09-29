/**
 * Pure, presentational task-execution components. No data fetching, no stores, no API calls —
 * everything comes from props, so the marketing site's simulated demo can render them with mock
 * data exactly as the product renders live tasks.
 *
 * ── TaskTimeline ─────────────────────────────────────────────────────────────────────────────
 *   <TaskTimeline events={TaskEvent[]} steps={TimelineStep[]} taskStatus="running" />
 *     events          TaskEvent[] (seq, event_type, step_id, actor_type, payload, created_at); any order
 *     steps?          [{ id, step_key, action, tool_name, tool_version?, plan_version? }] — names steps
 *     taskStatus?     TaskStatus — once not live, nothing keeps pulsing
 *     developerMode?  show "Advanced event data" (raw payloads) per entry
 *     showAllEvents?  include bookkeeping status changes implied by other events
 *     virtualizeAfter?/virtualHeight?  virtualization threshold (150) / viewport height ("70vh")
 *     empty?          node rendered when there are no events
 *     animate?        slide in entries that arrive after mount (default true, reduced-motion safe)
 *
 * ── LiveActivity ─────────────────────────────────────────────────────────────────────────────
 *   const { current } = buildTimeline(events, { steps, taskStatus });
 *   <LiveActivity current={current} status={taskStatus} />   contextual "doing now" indicator
 *
 * ── StepCard ─────────────────────────────────────────────────────────────────────────────────
 *   <StepCard step={StepOut-like} verification={VerificationOut?} total={n} developerMode? highlighted? />
 *
 * ── PlanGraph ────────────────────────────────────────────────────────────────────────────────
 *   <PlanGraph plan={task.plan} steps={StepOut[]} planVersion={1} taskStatus="running" goal="…" onSelectStep? />
 *
 * Pure helpers: buildTimeline / normalizeTimeline / groupByPhase / currentActivity (events → entries),
 * buildPlanGraph / extractStepRefs (plan → dependency levels). `fixtures.ts` has a realistic
 * recorded task (MEETING_EVENTS, MEETING_STEPS, MEETING_PLAN, meetingEventsUntil(seq)) for demos.
 */
export { TaskTimeline, PhaseHeader, type TaskTimelineProps } from "./task-timeline";
export { TimelineRow, TimelineNode, type TimelineRowProps } from "./timeline-row";
export { LiveActivity, type LiveActivityProps } from "./live-activity";
export { StepCard, type StepCardProps, type StepCardStep } from "./step-card";
export { PlanGraph, type PlanGraphProps } from "./plan-graph";
export {
  buildTimeline,
  normalizeTimeline,
  groupByPhase,
  currentActivity,
  phaseLabel,
  errorLabel,
  verificationMethodLabel,
  type NormalizeOptions,
  type TimelineEntry,
  type TimelineEntryKind,
  type TimelineEntryState,
  type TimelinePhase,
  type TimelinePhaseGroup,
  type TimelineStep,
} from "./normalize";
export { buildPlanGraph, extractStepRefs, type PlanGraphModel, type PlanGraphNode, type PlanGraphStep } from "./plan-graph-model";
export { toolIcon, toolActivityVerb } from "./tool-meta";
export { MEETING_EVENTS, MEETING_PLAN, MEETING_STEPS, meetingEventsUntil } from "./fixtures";
