/**
 * Store records → API models. `buildSummary` is a port of `backend/app/execution/summary.py`:
 * deterministic, built only from recorded steps, verifications, approvals and questions.
 */
import type {
  ApprovalOut,
  StepOut,
  SummaryWaitingItem,
  TaskDetail,
  TaskOut,
  TaskSummaryOut,
  VerificationOut,
} from "@/lib/api";
import type { ApprovalRec, DemoStore, StepRec, TaskRec, VerificationRec } from "./store";
import { clone } from "./util";

const STATUS_HEADLINES: Partial<Record<string, string>> = {
  completed: "Done — every action was verified.",
  failed: "The task did not complete.",
  cancelled: "The task was cancelled.",
  waiting_approval: "Waiting for your approval.",
  waiting_input: "Waiting for your input.",
  blocked: "Blocked — action needed from you.",
  requires_reconciliation: "Needs your confirmation before continuing.",
  expired: "Expired while waiting.",
};

export function buildSummary(store: DemoStore, task: TaskRec): TaskSummaryOut {
  const steps = store.stepsOf(task);
  const latest = new Map<string, VerificationRec>();
  for (const v of store.verifications)
    if (v.taskId === task.id && v.scope === "step" && v.step_id) latest.set(v.step_id, v);
  const pending = [...store.approvals.values()].filter((a) => a.task_id === task.id && a.status === "pending");

  const happened: TaskSummaryOut["what_happened"] = [];
  const changed: TaskSummaryOut["what_changed"] = [];
  const verified: TaskSummaryOut["what_was_verified"] = [];
  const failed: TaskSummaryOut["what_failed"] = [];
  for (const st of steps) {
    happened.push({ step: st.key, action: st.action, tool: st.tool, status: st.status, summary: st.outputSummary });
    if (st.status === "completed" && st.permissionLevel !== "read") {
      changed.push({ step: st.key, tool: st.tool, description: st.outputSummary, external_ref: st.externalRef });
    }
    const v = latest.get(st.id);
    if (v) {
      verified.push({
        step: st.key,
        method: v.method,
        status: v.status,
        differences: v.differences.map((d) => (d.field as string | undefined) ?? null).slice(0, 5),
      });
    }
    if (st.status === "failed" || st.status === "blocked" || st.status === "requires_reconciliation") {
      failed.push({
        step: st.key,
        tool: st.tool,
        status: st.status,
        error_class: st.errorClass,
        message: st.errorMessage,
      });
    }
  }
  const waiting: SummaryWaitingItem[] = pending.map((a) => ({
    type: "approval",
    approval_id: a.id,
    summary: a.summary,
    expires_at: a.expires_at,
  }));
  for (const question of task.pendingQuestions ?? []) waiting.push({ type: "input", question });
  if (task.status === "requires_reconciliation") {
    for (const f of failed) {
      if (f.status === "requires_reconciliation")
        waiting.push({ type: "confirm_outcome", step: f.step, message: f.message });
    }
  }
  let headline = STATUS_HEADLINES[task.status] ?? `Task is ${task.status.replace(/_/g, " ")}.`;
  if (task.status === "failed" && task.failureMessage)
    headline = `The task did not complete: ${task.failureMessage.slice(0, 300)}`;
  if (changed.length && task.status === "completed") {
    headline = `Done: ${changed.map((c) => c.description || c.tool).join("; ")}`.slice(0, 606);
  }
  const summary: TaskSummaryOut = {
    status: task.status,
    headline,
    what_happened: happened,
    what_changed: changed,
    what_was_verified: verified,
    what_failed: failed,
    waiting_for_user: waiting,
    partial_completion: changed.length > 0 && task.status !== "completed",
  };
  const direct = (task.plan?.direct_response as string | null | undefined) ?? null;
  if (direct) {
    summary.direct_response = direct;
    summary.direct_response_note = "Answered by the model without taking any action; not externally verified.";
  }
  return summary;
}

export function taskOut(task: TaskRec): TaskOut {
  return {
    task_id: task.id,
    status: task.status,
    goal: task.goal,
    agent_id: task.agentId,
    agent_version_id: task.agentVersionId,
    priority: task.priority,
    progress: task.progress,
    plan_version: task.planVersion,
    model_calls: task.modelCalls,
    tool_calls: task.toolCalls,
    pending_questions: task.pendingQuestions ? [...task.pendingQuestions] : null,
    failure_code: task.failureCode,
    failure_message: task.failureMessage,
    result_summary: clone(task.resultSummary),
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    started_at: task.startedAt,
    completed_at: task.completedAt,
  };
}

export function stepOut(st: StepRec): StepOut {
  return {
    id: st.id,
    step_key: st.key,
    position: st.position,
    plan_version: st.planVersion,
    action: st.action,
    tool_name: st.tool,
    tool_version: st.toolVersion,
    status: st.status,
    permission_level: st.permissionLevel,
    risk_level: st.riskLevel,
    requires_approval: st.requiresApproval,
    policy_reasons: [...st.policyReasons],
    approval_request_id: st.approvalRequestId,
    attempt_count: st.attemptCount,
    started_at: st.startedAt,
    completed_at: st.completedAt,
    output_summary: st.outputSummary,
    output_trust: st.outputTrust,
    external_ref: st.externalRef,
    error_class: st.errorClass,
    error_message: st.errorMessage,
    verification_method: st.verificationMethod,
    verification_status: st.verificationStatus,
  };
}

export function verificationOut(v: VerificationRec): VerificationOut {
  const { taskId: _taskId, ...out } = v;
  void _taskId;
  return clone(out);
}

export function taskDetail(store: DemoStore, task: TaskRec): TaskDetail {
  const meta = task.agentLabel ?? { label: "builtin-default:v1" };
  return {
    ...taskOut(task),
    plan: clone(task.plan),
    steps: store.stepsOf(task, null).map(stepOut),
    verifications: store.verifications.filter((v) => v.taskId === task.id).map(verificationOut),
    reproducibility: {
      agent: meta,
      agent_version_id: task.agentVersionId,
      model: task.planVersion > 0 ? "agentos-demo-planner" : null,
      tool_versions: clone((task.plan?.tool_versions as Record<string, string> | undefined) ?? {}),
      policy_version: task.policyVersion,
      strategy_version: task.planVersion > 0 ? "baseline" : null,
      plan_version: task.planVersion,
      region: "demo",
    },
  };
}

export function approvalOut(a: ApprovalRec): ApprovalOut {
  const { actionHash: _hash, ...out } = a;
  void _hash;
  return clone(out);
}
