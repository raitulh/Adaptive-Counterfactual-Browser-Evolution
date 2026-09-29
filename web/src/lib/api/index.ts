/**
 * AgentOS API layer — the only way the web app talks to the backend.
 *
 *   import { tasksApi, type TaskOut, AgentOSApiError } from "@/lib/api";
 *
 * Domain modules are thin, fully typed wrappers over the generated OpenAPI contract
 * (src/lib/api/generated, regenerated with `npm run api:generate`).
 */
export { api, call, newIdempotencyKey } from "./client";
export {
  AgentOSApiError,
  errorFromResponse,
  isApiError,
  normalizeError,
  type ApiErrorKind,
  type ValidationIssue,
} from "./errors";
export { sessionStore, refreshSession, getAccessToken, type Session } from "./session";

export { acbeApi, type ListCandidatesQuery } from "./acbe";
export { adminApi } from "./admin";
export { agentsApi } from "./agents";
export { approvalsApi, type ListApprovalsQuery } from "./approvals";
export { auditApi, type ListAuditQuery } from "./audit";
export { authApi } from "./auth";
export { automationsApi } from "./automations";
export { billingApi } from "./billing";
export { evaluationsApi, experimentsApi } from "./evaluations";
export { filesApi, resolveApiUrl, type ListFilesQuery, type UploadOptions, type UploadPurpose } from "./files";
export { integrationsApi } from "./integrations";
export { mcpApi } from "./mcp";
export { memoryApi, type ListMemoryQuery } from "./memory";
export { notificationsApi, type ListNotificationsQuery } from "./notifications";
export { organizationsApi } from "./organizations";
export { searchApi } from "./search";
export { tasksApi, normalizeTaskDetail, type ListTasksQuery, type TaskDetailView } from "./tasks";
export { toolsApi } from "./tools";
export { usageApi } from "./usage";
export { usersApi } from "./users";

export * from "./schemas";
