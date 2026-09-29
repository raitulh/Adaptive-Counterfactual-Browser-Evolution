/**
 * Platform administration (platform admins only; the backend enforces it, the UI hides it).
 */
import { api, call } from "./client";
import type { FlagIn, OrgPlanUpdate, UserStatusUpdate } from "./schemas";

type Opts = { signal?: AbortSignal };

export const adminApi = {
  system: (o: Opts = {}) => call(api.GET("/api/v1/admin/system", { signal: o.signal })),
  users: (query: { email?: string | null; limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/users", { params: { query }, signal: o.signal })),
  updateUser: (userId: string, body: UserStatusUpdate) =>
    call(api.PATCH("/api/v1/admin/users/{user_id}", { params: { path: { user_id: userId } }, body })),
  organizations: (query: { limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/organizations", { params: { query }, signal: o.signal })),
  updateOrganization: (orgId: string, body: OrgPlanUpdate) =>
    call(api.PATCH("/api/v1/admin/organizations/{org_id}", { params: { path: { org_id: orgId } }, body })),
  securityEvents: (query: { limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/security-events", { params: { query }, signal: o.signal })),
  task: (taskId: string, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/tasks/{task_id}", { params: { path: { task_id: taskId } }, signal: o.signal })),
  deadJobs: (query: { limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/jobs/dead", { params: { query }, signal: o.signal })),
  retryJob: (jobId: string) =>
    call(api.POST("/api/v1/admin/jobs/{job_id}/retry", { params: { path: { job_id: jobId } } })),
  usage: (query: { limit?: number } = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/admin/usage", { params: { query }, signal: o.signal })),
  featureFlags: (o: Opts = {}) => call(api.GET("/api/v1/admin/feature-flags", { signal: o.signal })),
  setFeatureFlag: (body: FlagIn) => call(api.PUT("/api/v1/admin/feature-flags", { body })),
};
