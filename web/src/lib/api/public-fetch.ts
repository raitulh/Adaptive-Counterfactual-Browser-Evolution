/**
 * Implementation of `./public` (import it from there: that module is guarded by "server-only").
 * Kept separate so it can be unit-tested outside the Next.js bundler.
 *
 * Server-only access to PUBLIC AgentOS API endpoints (no credentials), for marketing pages rendered
 * on the server (e.g. /pricing).
 *
 * Browser code keeps using the typed client in `./client`; this module never runs in the browser,
 * never sends cookies or tokens, and never throws: an unreachable or misbehaving API yields a typed
 * failure so pages can render an honest fallback (and builds never fail because the API is down).
 */
import type { PlanOut } from "./schemas";

export type PublicFetchFailure = {
  ok: false;
  reason: "unreachable" | "http_error" | "invalid_response";
  status?: number;
};
export type PublicFetchResult<T> = { ok: true; data: T } | PublicFetchFailure;

type EnvLike = { readonly [key: string]: string | undefined };

/**
 * Base URL of the API for server-side calls, ending in `/api/v1`:
 * an absolute `NEXT_PUBLIC_API_URL` wins (the browser calls the API directly in that deployment);
 * otherwise `AGENTOS_API_ORIGIN` (the upstream of the same-origin pass-through), default
 * `http://localhost:8000`.
 */
export function publicApiBase(vars: EnvLike = process.env): string {
  const publicUrl = vars.NEXT_PUBLIC_API_URL?.trim();
  if (publicUrl && /^https?:\/\//i.test(publicUrl)) return publicUrl.replace(/\/+$/, "");
  const origin = (vars.AGENTOS_API_ORIGIN?.trim() || "http://localhost:8000").replace(/\/+$/, "");
  return `${origin}/api/v1`;
}

/** Origin that serves the interactive API reference (`/docs`) — the API origin itself. */
export function publicApiOrigin(vars: EnvLike = process.env): string {
  return publicApiBase(vars).replace(/\/api\/v1$/, "");
}

/**
 * Where visitors can open the interactive API reference (the API serves it at `/docs`), or null when
 * the only known API origin is an internal address that must not be published.
 */
export function publicApiDocsUrl(vars: EnvLike = process.env): string | null {
  const publicUrl = vars.NEXT_PUBLIC_API_URL?.trim();
  if (publicUrl && /^https?:\/\//i.test(publicUrl)) return `${new URL(publicUrl).origin}/docs`;
  const origin = (vars.AGENTOS_API_ORIGIN?.trim() || "http://localhost:8000").replace(/\/+$/, "");
  try {
    const host = new URL(origin).hostname;
    return host === "localhost" || host === "127.0.0.1" ? `${origin}/docs` : null;
  } catch {
    return null;
  }
}

const TIMEOUT_MS = 4_000;

function isPlan(value: unknown): value is PlanOut {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.display_name === "string" &&
    Array.isArray(p.features) &&
    typeof p.max_concurrent_tasks === "number" &&
    typeof p.max_automations === "number" &&
    typeof p.max_members === "number" &&
    !!p.monthly_quotas &&
    typeof p.monthly_quotas === "object"
  );
}

export interface PublicFetchOptions {
  fetchImpl?: typeof fetch;
  env?: EnvLike;
  timeoutMs?: number;
}

/**
 * `GET /billing/plans` (public). Cached by Next for 5 minutes (`revalidate: 300`), so the pricing
 * page is statically regenerated rather than calling the API per request.
 */
export async function getPublicPlans(options: PublicFetchOptions = {}): Promise<PublicFetchResult<PlanOut[]>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = `${publicApiBase(options.env)}/billing/plans`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      next: { revalidate: 300 },
    } as RequestInit);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) return { ok: false, reason: "http_error", status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "invalid_response", status: response.status };
  }
  if (!Array.isArray(body) || !body.every(isPlan)) {
    return { ok: false, reason: "invalid_response", status: response.status };
  }
  return { ok: true, data: body };
}
