import * as z from "zod";

export const apiErrorCodeSchema = z.enum([
  "NETWORK_ERROR",
  "TIMEOUT",
  "ABORTED",
  "SESSION_EXPIRED",
  "RATE_LIMITED",
  "UNAUTHORIZED",
  "INVALID_CREDENTIALS",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "INVALID_RESPONSE",
  "SERVER_ERROR",
  "UNKNOWN",
]);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

export const apiErrorSchema = z.object({
  code: apiErrorCodeSchema,
  /** Human-readable, safe to display. Never contains request payloads. */
  message: z.string(),
  status: z.number().int().optional(),
  retryable: z.boolean(),
  requestId: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/**
 * Error envelope a backend may return: `{ "error": { "code", "message", "requestId" } }`.
 * FastAPI's default `{ "detail": ... }` shape is also accepted by the HTTP adapter.
 */
export const apiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
