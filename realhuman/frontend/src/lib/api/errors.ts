import type { ApiError, ApiErrorCode } from "@/lib/schemas/api-error";

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  NETWORK_ERROR: "We couldn't reach the verification service. Check your connection and try again.",
  TIMEOUT: "The verification service took too long to respond.",
  ABORTED: "The request was cancelled.",
  SESSION_EXPIRED: "This verification session expired before it was completed.",
  RATE_LIMITED: "Too many requests. Wait a moment and try again.",
  UNAUTHORIZED: "You need to sign in to continue.",
  INVALID_CREDENTIALS: "That email and password combination didn't work.",
  VALIDATION_ERROR: "Some of the submitted information is invalid.",
  NOT_FOUND: "The requested resource was not found.",
  INVALID_RESPONSE: "The service returned an unexpected response.",
  SERVER_ERROR: "The service ran into a problem. Try again shortly.",
  UNKNOWN: "Something went wrong.",
};

const RETRYABLE: ReadonlySet<ApiErrorCode> = new Set([
  "NETWORK_ERROR",
  "TIMEOUT",
  "RATE_LIMITED",
  "SERVER_ERROR",
]);

/** Error thrown by every adapter. Components read `.error`, a serializable ApiError. */
export class ApiRequestError extends Error {
  readonly error: ApiError;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiRequestError";
    this.error = error;
  }
}

export function createApiError(
  code: ApiErrorCode,
  overrides: Partial<Omit<ApiError, "code">> = {},
): ApiRequestError {
  return new ApiRequestError({
    code,
    message: overrides.message ?? DEFAULT_MESSAGES[code],
    retryable: overrides.retryable ?? RETRYABLE.has(code),
    ...(overrides.status !== undefined ? { status: overrides.status } : {}),
    ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
  });
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

export function isAbortError(value: unknown): boolean {
  return (
    (value instanceof DOMException && value.name === "AbortError") ||
    (isApiRequestError(value) && value.error.code === "ABORTED")
  );
}

/** Normalizes anything thrown into an ApiError without leaking internals. */
export function toApiError(value: unknown): ApiError {
  if (isApiRequestError(value)) return value.error;
  if (value instanceof DOMException && value.name === "AbortError") {
    return createApiError("ABORTED").error;
  }
  if (value instanceof DOMException && value.name === "TimeoutError") {
    return createApiError("TIMEOUT").error;
  }
  if (value instanceof TypeError) return createApiError("NETWORK_ERROR").error;
  return createApiError("UNKNOWN").error;
}

export function codeFromStatus(status: number): ApiErrorCode {
  if (status === 401 || status === 403) return "UNAUTHORIZED";
  if (status === 404) return "NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (status === 410) return "SESSION_EXPIRED";
  if (status === 400 || status === 422) return "VALIDATION_ERROR";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER_ERROR";
  return "UNKNOWN";
}
