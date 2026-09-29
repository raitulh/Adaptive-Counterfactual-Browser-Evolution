/**
 * Evaluation runs and experiments (developer-facing; gated by `experiments:manage`).
 */
import { api, call, newIdempotencyKey } from "./client";
import type { EvaluationRunCreate, ExperimentCreate, RollbackRequest, RolloutRequest } from "./schemas";

type Opts = { signal?: AbortSignal };
type PageQuery = { cursor?: string | null; limit?: number };

export const evaluationsApi = {
  list: (query: PageQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/evaluations", { params: { query }, signal: o.signal })),
  suites: (o: Opts = {}) => call(api.GET("/api/v1/evaluations/suites", { signal: o.signal })),
  get: (runId: string, o: Opts = {}) =>
    call(api.GET("/api/v1/evaluations/{run_id}", { params: { path: { run_id: runId } }, signal: o.signal })),
  start: (body: EvaluationRunCreate, idempotencyKey: string = newIdempotencyKey()) =>
    call(api.POST("/api/v1/evaluations", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
};

export const experimentsApi = {
  list: (query: PageQuery = {}, o: Opts = {}) =>
    call(api.GET("/api/v1/experiments", { params: { query }, signal: o.signal })),
  get: (experimentId: string, o: Opts = {}) =>
    call(
      api.GET("/api/v1/experiments/{experiment_id}", {
        params: { path: { experiment_id: experimentId } },
        signal: o.signal,
      }),
    ),
  create: (body: ExperimentCreate, idempotencyKey: string = newIdempotencyKey()) =>
    call(api.POST("/api/v1/experiments", { body, params: { header: { "Idempotency-Key": idempotencyKey } } })),
  start: (experimentId: string) =>
    call(api.POST("/api/v1/experiments/{experiment_id}/start", { params: { path: { experiment_id: experimentId } } })),
  decide: (experimentId: string) =>
    call(
      api.POST("/api/v1/experiments/{experiment_id}/decide", { params: { path: { experiment_id: experimentId } } }),
    ),
  rollout: (experimentId: string, body: RolloutRequest) =>
    call(
      api.POST("/api/v1/experiments/{experiment_id}/rollout", {
        params: { path: { experiment_id: experimentId } },
        body,
      }),
    ),
  rollback: (experimentId: string, body: RollbackRequest) =>
    call(
      api.POST("/api/v1/experiments/{experiment_id}/rollback", {
        params: { path: { experiment_id: experimentId } },
        body,
      }),
    ),
};
