/**
 * Audit log presentation + URL filter mapping (pure).
 *
 * Categories mirror backend `app/audit/service.py AuditCategory`; statuses and actor types are the
 * values the backend records (`AuditLog.status`, `ActorType`). Unknown values still render (neutral).
 */
import type { ListAuditQuery } from "@/lib/api";
import type { Tone } from "@/lib/status";

export const AUDIT_CATEGORIES = [
  "security",
  "auth",
  "task",
  "tool",
  "approval",
  "integration",
  "admin",
  "data",
  "memory",
  "automation",
  "billing",
  "experiment",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  security: "Security",
  auth: "Sign-in",
  task: "Task",
  tool: "Tool",
  approval: "Approval",
  integration: "Integration",
  admin: "Administration",
  data: "Data",
  memory: "Memory",
  automation: "Automation",
  billing: "Billing",
  experiment: "Experiment",
};

export const CATEGORY_TONE: Record<string, Tone> = {
  security: "danger",
  auth: "info",
  task: "accent",
  tool: "accent",
  approval: "warning",
  integration: "info",
  admin: "verify",
  data: "neutral",
  memory: "neutral",
  automation: "info",
  billing: "neutral",
  experiment: "verify",
};

export function auditStatusTone(status: string): Tone {
  switch (status) {
    case "success":
    case "completed":
      return "success";
    case "failure":
    case "failed":
    case "denied":
    case "blocked":
      return "danger";
    case "pending":
    case "waiting_approval":
      return "warning";
    case "started":
      return "accent";
    default:
      return "neutral";
  }
}

export const ACTOR_LABEL: Record<string, string> = {
  user: "User",
  system: "System",
  worker: "Worker",
  agent: "Agent",
  scheduler: "Scheduler",
  admin: "Platform admin",
  automation: "Automation",
};

// ------------------------------------------------------------------------------------ URL filters
export interface AuditFilters {
  category: string | null;
  action: string | null;
  task_id: string | null;
  user_id: string | null;
}

export const EMPTY_FILTERS: AuditFilters = { category: null, action: null, task_id: null, user_id: null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Read filters from the URL, dropping values the API would reject (so a bad link can't 422). */
export function filtersFromParams(params: URLSearchParams): AuditFilters {
  const get = (k: string) => {
    const v = params.get(k)?.trim();
    return v ? v : null;
  };
  const category = get("category");
  const action = get("action");
  const task = get("task_id");
  const user = get("user_id");
  return {
    category: category && category.length <= 30 ? category : null,
    action: action && action.length <= 100 ? action : null,
    task_id: task && isUuid(task) ? task.toLowerCase() : null,
    user_id: user && isUuid(user) ? user.toLowerCase() : null,
  };
}

export function filtersToParams(filters: AuditFilters, base?: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(base?.toString());
  for (const key of Object.keys(EMPTY_FILTERS) as Array<keyof AuditFilters>) {
    const v = filters[key];
    if (v) next.set(key, v);
    else next.delete(key);
  }
  return next;
}

export function filtersToQuery(filters: AuditFilters, limit = 50): ListAuditQuery {
  const q: ListAuditQuery = { limit };
  if (filters.category) q.category = filters.category;
  if (filters.action) q.action = filters.action;
  if (filters.task_id) q.task_id = filters.task_id;
  if (filters.user_id) q.user_id = filters.user_id;
  return q;
}

export function activeFilterCount(filters: AuditFilters): number {
  return Object.values(filters).filter(Boolean).length;
}
