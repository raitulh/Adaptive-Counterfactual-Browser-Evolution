import { api, call } from "./client";
import type { paths } from "./generated/schema";
import type { ApprovalOut } from "./schemas";

type Opts = { signal?: AbortSignal };
export type ListApprovalsQuery = NonNullable<paths["/api/v1/approvals"]["get"]["parameters"]["query"]>;

export const approvalsApi = {
  list: (query: ListApprovalsQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/approvals", { params: { query }, signal: o.signal })),

  get: (approvalId: string, o: Opts = {}): Promise<ApprovalOut> =>
    call(
      api.GET("/api/v1/approvals/{approval_id}", { params: { path: { approval_id: approvalId } }, signal: o.signal }),
    ),

  /** Approval is bound to the exact action shown; the backend consumes it once. */
  approve: (approvalId: string, idempotencyKey: string, note?: string): Promise<ApprovalOut> =>
    call(
      api.POST("/api/v1/approvals/{approval_id}/approve", {
        params: { path: { approval_id: approvalId }, header: { "Idempotency-Key": idempotencyKey } },
        body: note ? { note } : null,
      }),
    ),

  reject: (approvalId: string, idempotencyKey: string, reason: string): Promise<ApprovalOut> =>
    call(
      api.POST("/api/v1/approvals/{approval_id}/reject", {
        params: { path: { approval_id: approvalId }, header: { "Idempotency-Key": idempotencyKey } },
        body: { reason },
      }),
    ),
};
