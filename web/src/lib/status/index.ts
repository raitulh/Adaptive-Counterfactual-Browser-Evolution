/**
 * Presentation mapping for backend lifecycle values.
 *
 * Canonical values come from the generated contract; every map below is a `Record<Status, …>`, so
 * adding a status in the backend fails the web build until it gets a presentation. Colors carry
 * meaning consistently: violet = verification, amber = needs a human, orange = recovery,
 * emerald = verified success, red = failure, ion = active execution.
 */
import type {
  ApprovalStatus,
  ConnectionStatus,
  PermissionLevel,
  RiskLevel,
  StepStatus,
  TaskStatus,
  VerificationStatus,
} from "@/lib/api";

export type Tone = "accent" | "success" | "warning" | "danger" | "info" | "verify" | "recover" | "neutral";

/** Literal class names (Tailwind needs complete strings in source). */
export const toneClasses: Record<Tone, { text: string; bg: string; border: string; dot: string; soft: string }> = {
  accent: { text: "text-accent", bg: "bg-accent", border: "border-accent/30", dot: "bg-accent", soft: "bg-accent/10" },
  success: { text: "text-success", bg: "bg-success", border: "border-success/30", dot: "bg-success", soft: "bg-success/10" },
  warning: { text: "text-warning", bg: "bg-warning", border: "border-warning/30", dot: "bg-warning", soft: "bg-warning/10" },
  danger: { text: "text-danger", bg: "bg-danger", border: "border-danger/30", dot: "bg-danger", soft: "bg-danger/10" },
  info: { text: "text-info", bg: "bg-info", border: "border-info/30", dot: "bg-info", soft: "bg-info/10" },
  verify: { text: "text-verify", bg: "bg-verify", border: "border-verify/30", dot: "bg-verify", soft: "bg-verify/10" },
  recover: { text: "text-recover", bg: "bg-recover", border: "border-recover/30", dot: "bg-recover", soft: "bg-recover/10" },
  neutral: { text: "text-fg-muted", bg: "bg-fg-muted", border: "border-line-strong", dot: "bg-fg-subtle", soft: "bg-white/5" },
};

/** Lifecycle phase used by the task visualization: GOAL → PLAN → VALIDATE → APPROVE → EXECUTE → VERIFY → RECOVER → COMPLETE. */
export type LifecyclePhase = "goal" | "plan" | "validate" | "approve" | "execute" | "verify" | "recover" | "complete";

export interface StatusMeta {
  label: string;
  tone: Tone;
  description: string;
  /** Something is actively happening (animate / show live indicator). */
  live?: boolean;
  /** A person must act. */
  attention?: boolean;
  /** No further changes are possible. */
  terminal?: boolean;
}

export interface TaskStatusMeta extends StatusMeta {
  phase: LifecyclePhase;
}

export const taskStatusMeta: Record<TaskStatus, TaskStatusMeta> = {
  created: { label: "Received", tone: "neutral", phase: "goal", live: true, description: "AgentOS received the goal." },
  planning: { label: "Planning", tone: "accent", phase: "plan", live: true, description: "Understanding the goal and drafting a plan." },
  planned: { label: "Planned", tone: "accent", phase: "plan", live: true, description: "A plan was drafted." },
  validating: { label: "Validating", tone: "accent", phase: "validate", live: true, description: "Checking the plan against tools, permissions and policy." },
  waiting_approval: { label: "Needs approval", tone: "warning", phase: "approve", attention: true, description: "An action is waiting for your approval." },
  waiting_input: { label: "Needs input", tone: "warning", phase: "approve", attention: true, description: "AgentOS needs information from you to continue." },
  queued: { label: "Queued", tone: "neutral", phase: "execute", live: true, description: "Waiting for a worker." },
  running: { label: "Running", tone: "accent", phase: "execute", live: true, description: "Executing the plan." },
  verifying: { label: "Verifying", tone: "verify", phase: "verify", live: true, description: "Confirming results against the external systems." },
  recovering: { label: "Recovering", tone: "recover", phase: "recover", live: true, description: "Handling a failure and deciding the safest next step." },
  requires_reconciliation: { label: "Needs confirmation", tone: "recover", phase: "recover", attention: true, description: "An action's outcome could not be confirmed automatically." },
  paused: { label: "Paused", tone: "neutral", phase: "execute", description: "Paused. Resume to continue." },
  cancel_requested: { label: "Cancelling", tone: "neutral", phase: "execute", live: true, description: "Stopping at the next safe point." },
  completed: { label: "Completed", tone: "success", phase: "complete", terminal: true, description: "Finished and verified." },
  failed: { label: "Failed", tone: "danger", phase: "complete", description: "The task did not complete." },
  blocked: { label: "Blocked", tone: "danger", phase: "recover", attention: true, description: "Blocked by a missing connection, permission or policy." },
  expired: { label: "Expired", tone: "neutral", phase: "complete", description: "Expired before it could finish." },
  cancelled: { label: "Cancelled", tone: "neutral", phase: "complete", terminal: true, description: "Cancelled." },
};

export const stepStatusMeta: Record<StepStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "neutral", description: "Not started yet." },
  waiting_approval: { label: "Awaiting approval", tone: "warning", attention: true, description: "Waiting for your approval." },
  waiting_input: { label: "Awaiting input", tone: "warning", attention: true, description: "Waiting for your answer." },
  running: { label: "Running", tone: "accent", live: true, description: "Executing now." },
  waiting_external: { label: "In progress externally", tone: "accent", live: true, description: "Running in an isolated worker." },
  verifying: { label: "Verifying", tone: "verify", live: true, description: "Reading back the result to confirm it." },
  retry_scheduled: { label: "Retry scheduled", tone: "recover", live: true, description: "A transient failure; retrying shortly." },
  requires_reconciliation: { label: "Needs confirmation", tone: "recover", attention: true, description: "Outcome unknown; not repeated without confirmation." },
  completed: { label: "Completed", tone: "success", terminal: true, description: "Done." },
  failed: { label: "Failed", tone: "danger", terminal: true, description: "Did not complete." },
  skipped: { label: "Skipped", tone: "neutral", terminal: true, description: "Skipped because a prerequisite did not complete." },
  cancelled: { label: "Cancelled", tone: "neutral", terminal: true, description: "Cancelled." },
  blocked: { label: "Blocked", tone: "danger", attention: true, description: "Blocked by a missing connection, permission or policy." },
};

export const verificationStatusMeta: Record<VerificationStatus, StatusMeta> = {
  pending: { label: "Not verified yet", tone: "neutral", description: "Verification has not run." },
  passed: { label: "Verified", tone: "verify", description: "The external system confirms the result." },
  failed: { label: "Verification failed", tone: "danger", description: "The external system shows a different result." },
  inconclusive: { label: "Inconclusive", tone: "recover", attention: true, description: "The result could not be confirmed automatically." },
  not_applicable: { label: "No verification needed", tone: "neutral", description: "Read-only step." },
};

export const approvalStatusMeta: Record<ApprovalStatus, StatusMeta> = {
  pending: { label: "Pending", tone: "warning", attention: true, description: "Waiting for a decision." },
  approved: { label: "Approved", tone: "success", description: "Approved." },
  rejected: { label: "Rejected", tone: "danger", terminal: true, description: "Rejected." },
  expired: { label: "Expired", tone: "neutral", terminal: true, description: "Expired without a decision." },
  cancelled: { label: "Cancelled", tone: "neutral", terminal: true, description: "No longer needed." },
};

export const riskLevelMeta: Record<RiskLevel, StatusMeta & { rank: number }> = {
  low: { label: "Low risk", tone: "neutral", rank: 0, description: "Limited, reversible effect." },
  medium: { label: "Medium risk", tone: "info", rank: 1, description: "Visible effect that can be undone." },
  high: { label: "High risk", tone: "warning", rank: 2, description: "Hard to undo or visible to others." },
  critical: { label: "Critical risk", tone: "danger", rank: 3, description: "Irreversible or financial effect." },
};

export const permissionLevelMeta: Record<PermissionLevel, StatusMeta & { rank: number }> = {
  read: { label: "Read", tone: "neutral", rank: 0, description: "Reads data; changes nothing." },
  write: { label: "Write", tone: "info", rank: 1, description: "Creates or changes data." },
  high_risk_write: { label: "High-risk write", tone: "warning", rank: 2, description: "Sends or shares on your behalf." },
  destructive: { label: "Destructive", tone: "danger", rank: 3, description: "Deletes or overwrites data." },
  financial: { label: "Financial", tone: "danger", rank: 3, description: "Moves money or commits spend." },
  admin: { label: "Admin", tone: "danger", rank: 4, description: "Changes access or configuration." },
};

export const connectionStatusMeta: Record<ConnectionStatus, StatusMeta> = {
  connected: { label: "Connected", tone: "success", description: "Working normally." },
  expired: { label: "Expired", tone: "warning", attention: true, description: "Authorization expired — reconnect to continue." },
  revoked: { label: "Revoked", tone: "danger", attention: true, description: "Access was revoked at the provider — reconnect." },
  insufficient_scope: { label: "Missing permissions", tone: "warning", attention: true, description: "Reconnect and grant the requested capabilities." },
  temporarily_unavailable: { label: "Temporarily unavailable", tone: "recover", description: "The provider is not responding; AgentOS will retry." },
  disconnected: { label: "Disconnected", tone: "neutral", description: "Not connected." },
};

/**
 * Which task controls the backend accepts in a status (mirrors app/tasks/service.py preconditions).
 * The UI offers only these; the backend still decides (409 invalid_state_transition otherwise).
 */
export function taskControls(status: TaskStatus, planVersion: number) {
  const terminal = status === "completed" || status === "cancelled";
  const resumable =
    status === "paused" || status === "expired" || status === "blocked" || status === "failed" || status === "requires_reconciliation";
  return {
    cancel: !terminal && status !== "cancel_requested",
    pause: ["queued", "waiting_approval", "running", "verifying", "recovering"].includes(status),
    resume: resumable && (planVersion > 0 || status === "failed" || status === "blocked"),
    provideInput: status === "waiting_input",
    confirmOutcome: status === "requires_reconciliation",
  };
}

export function isTaskActive(status: TaskStatus): boolean {
  return Boolean(taskStatusMeta[status].live);
}
