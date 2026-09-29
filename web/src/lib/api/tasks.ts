import { api, call } from "./client";
import type { paths } from "./generated/schema";
import type {
  ExecutionLogOut,
  StepConfirmation,
  StepOut,
  TaskCreate,
  TaskDetail,
  TaskEvent,
  TaskEventsPage,
  TaskInput,
  TaskOut,
  TaskSummaryOut,
  VerificationOut,
} from "./schemas";

type Opts = { signal?: AbortSignal };
export type ListTasksQuery = NonNullable<paths["/api/v1/tasks"]["get"]["parameters"]["query"]>;

/** Task detail with defaulted collections made explicit (the contract marks them optional). */
export interface TaskDetailView extends Omit<TaskDetail, "steps" | "verifications" | "plan" | "reproducibility"> {
  plan: Record<string, unknown> | null;
  steps: StepOut[];
  verifications: VerificationOut[];
  reproducibility: Record<string, unknown>;
}

export function normalizeTaskDetail(detail: TaskDetail): TaskDetailView {
  return {
    ...detail,
    plan: (detail.plan as Record<string, unknown> | null | undefined) ?? null,
    steps: [...(detail.steps ?? [])].sort((a, b) => a.position - b.position),
    verifications: detail.verifications ?? [],
    reproducibility: (detail.reproducibility as Record<string, unknown> | undefined) ?? {},
  };
}

const EVENTS_PAGE = 500;

export const tasksApi = {
  list: (query: ListTasksQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/tasks", { params: { query }, signal: o.signal })),

  /** POST /tasks — the caller owns the idempotency key (reuse it when retrying the same submission). */
  create: (body: TaskCreate, idempotencyKey: string): Promise<TaskOut> =>
    call(api.POST("/api/v1/tasks", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),

  get: (taskId: string, o: Opts = {}): Promise<TaskDetailView> =>
    call(api.GET("/api/v1/tasks/{task_id}", { params: { path: { task_id: taskId } }, signal: o.signal })).then(
      normalizeTaskDetail,
    ),

  summary: (taskId: string, o: Opts = {}): Promise<TaskSummaryOut> =>
    call(api.GET("/api/v1/tasks/{task_id}/summary", { params: { path: { task_id: taskId } }, signal: o.signal })),

  events: (taskId: string, query: { after_seq?: number; limit?: number } = {}, o: Opts = {}): Promise<TaskEventsPage> =>
    call(
      api.GET("/api/v1/tasks/{task_id}/events", {
        params: { path: { task_id: taskId }, query },
        signal: o.signal,
      }),
    ),

  /** Every durable event after `afterSeq`, following `next_after_seq` until caught up. */
  async eventsAfter(taskId: string, afterSeq = 0, o: Opts = {}): Promise<TaskEvent[]> {
    const out: TaskEvent[] = [];
    let cursor: number | null = afterSeq;
    while (cursor !== null) {
      const page: TaskEventsPage = await tasksApi.events(taskId, { after_seq: cursor, limit: EVENTS_PAGE }, o);
      out.push(...page.items);
      cursor = page.next_after_seq ?? null;
      if (page.items.length === 0) break;
    }
    return out;
  },

  logs: (taskId: string, query: { limit?: number } = {}, o: Opts = {}): Promise<ExecutionLogOut[]> =>
    call(api.GET("/api/v1/tasks/{task_id}/logs", { params: { path: { task_id: taskId }, query }, signal: o.signal })),

  cancel: (taskId: string) =>
    call(api.POST("/api/v1/tasks/{task_id}/cancel", { params: { path: { task_id: taskId } } })),
  pause: (taskId: string) => call(api.POST("/api/v1/tasks/{task_id}/pause", { params: { path: { task_id: taskId } } })),
  resume: (taskId: string) =>
    call(api.POST("/api/v1/tasks/{task_id}/resume", { params: { path: { task_id: taskId } } })),

  provideInput: (taskId: string, body: TaskInput) =>
    call(api.POST("/api/v1/tasks/{task_id}/input", { params: { path: { task_id: taskId } }, body })),

  confirmStep: (taskId: string, stepId: string, body: StepConfirmation) =>
    call(
      api.POST("/api/v1/tasks/{task_id}/steps/{step_id}/confirm", {
        params: { path: { task_id: taskId, step_id: stepId } },
        body,
      }),
    ),
};
