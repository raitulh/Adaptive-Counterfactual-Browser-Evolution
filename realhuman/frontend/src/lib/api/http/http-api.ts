import * as z from "zod";
import { codeFromStatus, createApiError, isApiRequestError } from "@/lib/api/errors";
import type { AuthSession, RealHumanApi, RequestOptions } from "@/lib/api/types";
import { apiErrorEnvelopeSchema, apiErrorCodeSchema } from "@/lib/schemas/api-error";
import {
  apiKeySchema,
  createdApiKeySchema,
  createdWebhookEndpointSchema,
  overviewSchema,
  projectSettingsRecordSchema,
  requestLogSchema,
  sessionRecordSchema,
  verificationEventSchema,
  webhookEndpointSchema,
} from "@/lib/schemas/dashboard";
import { verificationResultSchema, verificationSessionSchema } from "@/lib/schemas/verification";
import { joinUrl } from "@/lib/utils/url";

export interface HttpApiOptions {
  baseUrl: string;
  /** Per-request timeout. */
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface RequestConfig<T> extends RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  schema?: z.ZodType<T>;
  query?: Record<string, string | number | undefined>;
}

const authSessionSchema: z.ZodType<AuthSession> = z.object({
  email: z.email(),
  workspace: z.string(),
});

/** Merges a caller's AbortSignal with a timeout signal and reports which fired. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function readErrorBody(response: Response) {
  try {
    const data: unknown = await response.json();
    const envelope = apiErrorEnvelopeSchema.safeParse(data);
    if (envelope.success) {
      const code = apiErrorCodeSchema.safeParse(envelope.data.error.code);
      return {
        code: code.success ? code.data : undefined,
        message: envelope.data.error.message,
        requestId: envelope.data.error.requestId,
      };
    }
  } catch {
    // Non-JSON error bodies are ignored; the status code is enough.
  }
  return {};
}

/**
 * REST implementation of RealHumanApi for a separately hosted backend (for
 * example FastAPI). Every response is validated before it reaches the UI.
 * Request and response payloads are never logged.
 */
export function createHttpApi({
  baseUrl,
  timeoutMs = 10_000,
  fetch: fetchImpl,
}: HttpApiOptions): RealHumanApi {
  const doFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));

  async function request<T>(path: string, config: RequestConfig<T> = {}): Promise<T> {
    const { method = "GET", body, schema, query, signal } = config;
    const url = new URL(joinUrl(baseUrl, path));
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const timeout = withTimeout(signal, timeoutMs);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        signal: timeout.signal,
        credentials: "include",
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (timeout.didTimeOut()) throw createApiError("TIMEOUT");
      if (error instanceof DOMException && error.name === "AbortError")
        throw createApiError("ABORTED");
      throw createApiError("NETWORK_ERROR");
    } finally {
      timeout.dispose();
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
      const detail = await readErrorBody(response);
      throw createApiError(detail.code ?? codeFromStatus(response.status), {
        status: response.status,
        ...(detail.message ? { message: detail.message } : {}),
        ...((detail.requestId ?? requestId) ? { requestId: detail.requestId ?? requestId } : {}),
      });
    }

    if (!schema || response.status === 204) return undefined as T;

    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw createApiError("INVALID_RESPONSE", { status: response.status });
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      throw createApiError("INVALID_RESPONSE", {
        status: response.status,
        ...(requestId ? { requestId } : {}),
      });
    }
    return parsed.data;
  }

  const id = (value: string) => encodeURIComponent(value);

  return {
    mode: "live",

    verification: {
      createSession: (input, options) =>
        request("/v1/sessions", {
          ...options,
          method: "POST",
          body: input,
          schema: verificationSessionSchema,
        }),
      async submitChallenge(sessionId, response, options = {}) {
        try {
          const result = await request(`/v1/sessions/${id(sessionId)}/challenge`, {
            signal: options.signal,
            method: "POST",
            body: response,
            schema: verificationResultSchema,
          });
          // REST returns all signals at once; replay them so the UI stays consistent.
          // A WebSocket transport can call onSignal as each one resolves.
          for (const signal of result.signals) options.onSignal?.(signal);
          return result;
        } catch (error) {
          if (isApiRequestError(error)) throw error;
          throw createApiError("UNKNOWN");
        }
      },
    },

    dashboard: {
      getOverview: (options) =>
        request("/v1/dashboard/overview", { ...options, schema: overviewSchema }),
      listEvents: ({ limit }, options) =>
        request("/v1/events", {
          ...options,
          query: { limit },
          schema: z.array(verificationEventSchema),
        }),
      listSessions: ({ outcome }, options) =>
        request("/v1/sessions", {
          ...options,
          query: { outcome },
          schema: z.array(sessionRecordSchema),
        }),
      listRequestLogs: ({ limit }, options) =>
        request("/v1/logs", { ...options, query: { limit }, schema: z.array(requestLogSchema) }),
    },

    apiKeys: {
      list: (options) => request("/v1/api-keys", { ...options, schema: z.array(apiKeySchema) }),
      create: (input, options) =>
        request("/v1/api-keys", {
          ...options,
          method: "POST",
          body: input,
          schema: createdApiKeySchema,
        }),
      revoke: (keyId, options) =>
        request<void>(`/v1/api-keys/${id(keyId)}`, { ...options, method: "DELETE" }),
    },

    webhooks: {
      list: (options) =>
        request("/v1/webhooks", { ...options, schema: z.array(webhookEndpointSchema) }),
      create: (input, options) =>
        request("/v1/webhooks", {
          ...options,
          method: "POST",
          body: input,
          schema: createdWebhookEndpointSchema,
        }),
      remove: (endpointId, options) =>
        request<void>(`/v1/webhooks/${id(endpointId)}`, { ...options, method: "DELETE" }),
    },

    settings: {
      get: (options) =>
        request("/v1/project/settings", { ...options, schema: projectSettingsRecordSchema }),
      update: (values, options) =>
        request("/v1/project/settings", {
          ...options,
          method: "PUT",
          body: values,
          schema: projectSettingsRecordSchema,
        }),
    },

    auth: {
      login: (credentials, options) =>
        request("/v1/auth/login", {
          ...options,
          method: "POST",
          body: credentials,
          schema: authSessionSchema,
        }),
      signup: (credentials, options) =>
        request("/v1/auth/signup", {
          ...options,
          method: "POST",
          body: credentials,
          schema: authSessionSchema,
        }),
      me: (options) => request("/v1/auth/me", { ...options, schema: authSessionSchema }),
      logout: (options) => request<void>("/v1/auth/logout", { ...options, method: "POST" }),
    },

    contact: {
      requestAccess: (input, options) =>
        request("/v1/contact", {
          ...options,
          method: "POST",
          body: input,
          schema: z.object({ received: z.literal(true) }),
        }),
    },
  };
}
