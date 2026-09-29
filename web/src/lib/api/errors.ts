/**
 * Normalized API errors.
 *
 * The backend answers every failure with `{"error": {"code", "message", "request_id", "details"}}`.
 * Everything that can go wrong on the way (network, aborts, proxies returning HTML) is folded into
 * one `AgentOSApiError` so UI code handles a single shape. Stack traces and raw bodies are never
 * surfaced to users.
 */

export type ApiErrorKind =
  | "validation" // 422 / request_validation
  | "unauthorized" // 401: missing/expired session
  | "forbidden" // 403: authenticated but not allowed
  | "not_found" // 404
  | "conflict" // 409: state conflicts, duplicates
  | "rate_limited" // 429
  | "payload_too_large" // 413
  | "unavailable" // 502/503/504: provider or API temporarily unavailable
  | "server" // other 5xx
  | "network" // the request never reached the API
  | "aborted" // cancelled by the caller
  | "unknown";

export interface ValidationIssue {
  loc: string[];
  msg: string;
  type: string;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    request_id: string | null;
    details: Record<string, unknown>;
  };
}

function kindFor(status: number, code: string): ApiErrorKind {
  if (status === 0) return code === "aborted" ? "aborted" : "network";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 413) return "payload_too_large";
  if (status === 422 || status === 400) return "validation";
  if (status === 429) return "rate_limited";
  if (status === 502 || status === 503 || status === 504) return "unavailable";
  if (status >= 500) return "server";
  return "unknown";
}

const FRIENDLY: Partial<Record<ApiErrorKind, string>> = {
  unauthorized: "Your session has ended. Please sign in again.",
  forbidden: "You don't have permission to perform this action.",
  not_found: "We couldn't find what you were looking for. It may have been removed, or you may not have access.",
  rate_limited: "You're doing that too often. Please wait a moment and try again.",
  payload_too_large: "That upload is too large.",
  unavailable: "The service is temporarily unavailable. Please try again shortly.",
  server: "Something failed on our side. The error has been recorded; please try again.",
  network: "We couldn't reach AgentOS. Check your connection and try again.",
  aborted: "The request was cancelled.",
};

export class AgentOSApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly details: Record<string, unknown>;
  readonly kind: ApiErrorKind;
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    requestId?: string | null;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number | null;
  }) {
    super(init.message);
    this.name = "AgentOSApiError";
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId ?? null;
    this.details = init.details ?? {};
    this.kind = kindFor(init.status, init.code);
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  /** Message safe to show to users. Backend messages are already user-safe for 4xx. */
  get userMessage(): string {
    if (this.kind === "validation" || this.kind === "conflict" || this.kind === "unknown") {
      return this.message || "The request could not be completed.";
    }
    if (this.kind === "not_found" || this.kind === "forbidden") {
      // Never reveal whether a hidden resource exists.
      return FRIENDLY[this.kind]!;
    }
    if (this.kind === "rate_limited" && this.retryAfterSeconds) {
      return `You're doing that too often. Try again in ${this.retryAfterSeconds}s.`;
    }
    return FRIENDLY[this.kind] ?? (this.message || "The request could not be completed.");
  }

  /** Transient failures worth retrying (reads are retried automatically; writes only with idempotency keys). */
  get isRetryable(): boolean {
    return this.kind === "network" || this.kind === "unavailable" || this.kind === "rate_limited" || this.status >= 500;
  }

  get validationIssues(): ValidationIssue[] {
    const errors = this.details.errors;
    return Array.isArray(errors) ? (errors as ValidationIssue[]) : [];
  }

  /** Field → message map for forms (uses the last `loc` segment, skipping "body"). */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of this.validationIssues) {
      const loc = issue.loc.filter((p) => p !== "body" && p !== "query" && p !== "path");
      const field = loc.join(".") || "_";
      out[field] ??= issue.msg.replace(/^Value error, /, "");
    }
    return out;
  }

  /** Permissions the backend reported as missing on a 403 (`details.missing_permissions`). */
  get missingPermissions(): string[] {
    const value = this.details.missing_permissions;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  }
}

export function isApiError(err: unknown): err is AgentOSApiError {
  return err instanceof AgentOSApiError;
}

function isEnvelope(body: unknown): body is ErrorEnvelope {
  return (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof (body as ErrorEnvelope).error === "object" &&
    (body as ErrorEnvelope).error !== null &&
    typeof (body as ErrorEnvelope).error.code === "string"
  );
}

function retryAfter(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}

/** Build an error from a non-2xx response and its (already parsed, if any) body. */
export function errorFromResponse(response: Response, body: unknown): AgentOSApiError {
  const requestId = response.headers.get("x-request-id");
  if (isEnvelope(body)) {
    return new AgentOSApiError({
      status: response.status,
      code: body.error.code,
      message: body.error.message,
      requestId: body.error.request_id ?? requestId,
      details: body.error.details ?? {},
      retryAfterSeconds: retryAfter(response),
    });
  }
  // FastAPI's default {"detail": ...} or a proxy page: never show raw bodies.
  return new AgentOSApiError({
    status: response.status,
    code: `http_${response.status}`,
    message: response.statusText || `Request failed with status ${response.status}`,
    requestId,
    retryAfterSeconds: retryAfter(response),
  });
}

export async function errorFromUnreadResponse(response: Response): Promise<AgentOSApiError> {
  let body: unknown = null;
  try {
    const text = await response.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return errorFromResponse(response, body);
}

/** Fold anything thrown (fetch TypeError, AbortError, our own errors) into an AgentOSApiError. */
export function normalizeError(err: unknown): AgentOSApiError {
  if (err instanceof AgentOSApiError) return err;
  if (err instanceof DOMException && err.name === "AbortError") {
    return new AgentOSApiError({ status: 0, code: "aborted", message: "The request was cancelled." });
  }
  if (err instanceof TypeError) {
    return new AgentOSApiError({ status: 0, code: "network_error", message: "Network request failed." });
  }
  return new AgentOSApiError({
    status: 0,
    code: "client_error",
    message: err instanceof Error ? err.message : "Unexpected error.",
  });
}
