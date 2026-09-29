/**
 * Organization audit log (append-only).
 */
import { api, call } from "./client";
import type { paths } from "./generated/schema";

type Opts = { signal?: AbortSignal };

export type ListAuditQuery = NonNullable<paths["/api/v1/audit"]["get"]["parameters"]["query"]>;

export const auditApi = {
  list: (query: ListAuditQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/audit", { params: { query }, signal: o.signal })),
};
