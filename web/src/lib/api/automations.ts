/**
 * Scheduled automations and their runs.
 */
import { api, call, newIdempotencyKey } from "./client";
import type { AutomationCreate, AutomationUpdate } from "./schemas";

type Opts = { signal?: AbortSignal };

export const automationsApi = {
  list: (query: { cursor?: string | null; limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/automations", { params: { query }, signal: o.signal })),
  get: (automationId: string, o: Opts = {}) =>
    call(
      api.GET("/api/v1/automations/{automation_id}", {
        params: { path: { automation_id: automationId } },
        signal: o.signal,
      }),
    ),
  create: (body: AutomationCreate, idempotencyKey: string = newIdempotencyKey()) =>
    call(api.POST("/api/v1/automations", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
  update: (automationId: string, body: AutomationUpdate) =>
    call(api.PATCH("/api/v1/automations/{automation_id}", { params: { path: { automation_id: automationId } }, body })),
  remove: (automationId: string) =>
    call(api.DELETE("/api/v1/automations/{automation_id}", { params: { path: { automation_id: automationId } } })),
  runs: (automationId: string, query: { cursor?: string | null; limit?: number } = {}, o: Opts = {}) =>
    call(
      api.GET("/api/v1/automations/{automation_id}/runs", {
        params: { path: { automation_id: automationId }, query },
        signal: o.signal,
      }),
    ),
  runNow: (automationId: string) =>
    call(
      api.POST("/api/v1/automations/{automation_id}/run-now", { params: { path: { automation_id: automationId } } }),
    ),
};
