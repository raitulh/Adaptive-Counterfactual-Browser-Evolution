/**
 * ACBE self-improvement lab: failure patterns → candidate strategies → evaluation → canary → promotion.
 */
import { api, call } from "./client";
import type { paths } from "./generated/schema";
import type { CanaryRequest, RollbackRequest } from "./schemas";

type Opts = { signal?: AbortSignal };
export type ListCandidatesQuery = NonNullable<paths["/api/v1/acbe/candidates"]["get"]["parameters"]["query"]>;

export const acbeApi = {
  failures: (o: Opts = {}) => call(api.GET("/api/v1/acbe/failures", { signal: o.signal })),
  candidates: (query: ListCandidatesQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/acbe/candidates", { params: { query }, signal: o.signal })),
  candidate: (candidateId: string, o: Opts = {}) =>
    call(
      api.GET("/api/v1/acbe/candidates/{candidate_id}", {
        params: { path: { candidate_id: candidateId } },
        signal: o.signal,
      }),
    ),
  evaluate: (candidateId: string) =>
    call(
      api.POST("/api/v1/acbe/candidates/{candidate_id}/evaluate", { params: { path: { candidate_id: candidateId } } }),
    ),
  canary: (candidateId: string, body: CanaryRequest) =>
    call(
      api.POST("/api/v1/acbe/candidates/{candidate_id}/canary", {
        params: { path: { candidate_id: candidateId } },
        body,
      }),
    ),
  promote: (candidateId: string) =>
    call(
      api.POST("/api/v1/acbe/candidates/{candidate_id}/promote", { params: { path: { candidate_id: candidateId } } }),
    ),
  rollback: (candidateId: string, body: RollbackRequest) =>
    call(
      api.POST("/api/v1/acbe/candidates/{candidate_id}/rollback", {
        params: { path: { candidate_id: candidateId } },
        body,
      }),
    ),
};
