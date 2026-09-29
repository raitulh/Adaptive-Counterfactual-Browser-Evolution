/**
 * Presentation for automations and runs, from backend values (app/automations/models.py,
 * service.py). `AutomationOut.task_template/retry_policy/policy` are typed as open objects by the
 * API contract; the readers below extract the documented fields defensively.
 */
import type {
  AutomationOut,
  AutomationPolicy,
  AutomationRunOut,
  AutomationRunStatus,
  RetryPolicy,
  TaskTemplate,
} from "@/lib/api";
import { humanize } from "@/lib/format";
import type { StatusMeta } from "@/lib/status";

export interface RunPresentation extends StatusMeta {
  /** The run still changes on the server (poll). */
  open: boolean;
}

export const runStatusMeta: Record<AutomationRunStatus, StatusMeta> = {
  created: {
    label: "Running",
    tone: "accent",
    live: true,
    description: "The run created its task, which is executing now.",
  },
  succeeded: { label: "Succeeded", tone: "success", terminal: true, description: "The run's task completed." },
  failed: { label: "Failed", tone: "danger", terminal: true, description: "The run or its task failed." },
  skipped: { label: "Skipped", tone: "neutral", terminal: true, description: "The occurrence was skipped." },
};

/** A run's state, refined by whether its task exists yet and whether a retry is scheduled. */
export function presentRun(
  run: Pick<AutomationRunOut, "status" | "task_id" | "next_attempt_at" | "error">,
): RunPresentation {
  if (run.status === "created") {
    if (!run.task_id && run.next_attempt_at) {
      return {
        label: "Retry scheduled",
        tone: "recover",
        live: true,
        open: true,
        description: `Creating the task failed (${describeRunError(run.error) ?? "transient error"}); AgentOS retries automatically.`,
      };
    }
    if (!run.task_id)
      return { label: "Starting", tone: "neutral", live: true, open: true, description: "Creating the run's task." };
    return { ...runStatusMeta.created, open: true };
  }
  const meta = (runStatusMeta as Record<string, StatusMeta>)[run.status];
  return meta
    ? { ...meta, open: false }
    : { label: humanize(run.status), tone: "neutral", description: "", open: false };
}

/** `AutomationOut.last_status` (the latest run's status, or null before the first run). */
export function presentLastStatus(status: string | null | undefined): StatusMeta | null {
  if (!status) return null;
  return (
    (runStatusMeta as Record<string, StatusMeta>)[status] ?? {
      label: humanize(status),
      tone: "neutral",
      description: "",
    }
  );
}

const RUN_ERRORS: Record<string, string> = {
  invalid_template: "The task template is no longer valid",
  owner_access_lost: "You no longer have permission to create tasks",
  automation_disabled: "The automation was disabled before the run started",
  task_deleted: "The run's task was deleted",
  task_cancelled: "The task was cancelled",
  task_failed: "The task failed",
  task_expired: "The task expired before it finished",
  task_blocked: "The task was blocked (missing connection, permission or policy)",
  quota_exceeded: "Your plan's usage limit was reached",
  automation_limit_reached: "Your plan's automation limit was reached",
  rate_limited: "Too many tasks were started at once",
  internal_error: "An internal error occurred",
};

export function describeRunError(code: string | null | undefined): string | null {
  if (!code) return null;
  return RUN_ERRORS[code] ?? humanize(code);
}

export const disabledReasonMeta: Record<string, { label: string; description: string }> = {
  paused_after_failures: {
    label: "Paused after repeated failures",
    description:
      "It failed too many times in a row. Fix the cause (for example a disconnected integration), then turn it back on.",
  },
  owner_access_lost: {
    label: "Disabled: permission lost",
    description: "You no longer have permission to create tasks in this organization, so runs can't start.",
  },
  max_runs_reached: {
    label: "Finished: run limit reached",
    description: "It has completed its maximum number of scheduled runs. Raise the limit to turn it back on.",
  },
  schedule_exhausted: {
    label: "Finished: no future runs",
    description: "Its schedule has no future occurrences.",
  },
};

export function presentAutomationState(a: Pick<AutomationOut, "enabled" | "disabled_reason">): StatusMeta {
  if (a.enabled) return { label: "Active", tone: "success", description: "Runs on schedule." };
  if (a.disabled_reason) {
    const meta = disabledReasonMeta[a.disabled_reason];
    return {
      label: meta?.label ?? humanize(a.disabled_reason),
      tone:
        a.disabled_reason === "paused_after_failures" || a.disabled_reason === "owner_access_lost"
          ? "danger"
          : "neutral",
      description: meta?.description ?? "",
      attention: a.disabled_reason === "paused_after_failures" || a.disabled_reason === "owner_access_lost",
    };
  }
  return {
    label: "Paused",
    tone: "neutral",
    description: "Turned off by you. It won't run until you turn it back on.",
  };
}

// ---------------------------------------------------------------------------- readers

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function readTemplate(raw: Record<string, unknown> | null | undefined): Required<
  Pick<TaskTemplate, "goal" | "priority">
> & {
  agent_id: string | null;
  context: string | null;
  max_duration_seconds: number | null;
} {
  const r = raw ?? {};
  return {
    goal: str(r.goal) ?? "",
    agent_id: str(r.agent_id),
    context: str(r.context),
    priority: num(r.priority, 100),
    max_duration_seconds: typeof r.max_duration_seconds === "number" ? r.max_duration_seconds : null,
  };
}

export function readRetryPolicy(raw: Record<string, unknown> | null | undefined): Required<RetryPolicy> {
  return { max_attempts: num(raw?.max_attempts, 3), backoff_seconds: num(raw?.backoff_seconds, 60) };
}

export function readPolicy(raw: Record<string, unknown> | null | undefined): Required<AutomationPolicy> {
  return {
    pause_on_failure: typeof raw?.pause_on_failure === "boolean" ? raw.pause_on_failure : true,
    max_consecutive_failures: num(raw?.max_consecutive_failures, 3),
  };
}

export function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60}s` : `${s / 60} min`;
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
