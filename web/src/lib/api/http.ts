/**
 * The single fetch implementation for AgentOS API calls (used by the typed client in client.ts).
 *
 *  - attaches `Authorization: Bearer <access token>` (refreshing first when it is about to expire);
 *  - on 401 from a protected endpoint: refresh once (single-flight) and retry the ORIGINAL request
 *    once with the new token; if refresh fails the session is cleared and listeners are notified;
 *  - never refreshes for auth endpoints themselves (no infinite loops);
 *  - in demo mode, requests are answered by the in-browser demo backend instead of the network.
 */
import { getAccessToken, refreshSession } from "./session";
import { getTransport } from "./transport";

/** Public auth endpoints: sent without a bearer token and never refresh-and-retried (no loops). */
const PUBLIC_AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/refresh",
  "/auth/oauth/google/start",
  "/auth/oauth/google/callback",
];

/** 401 codes that mean "credentials are wrong", not "token expired": refreshing cannot help. */
const NON_REFRESHABLE_CODES = new Set(["invalid_credentials", "mfa_required", "invalid_mfa_code", "csrf_failed"]);

function apiPath(url: string): string {
  const u = new URL(url, typeof window === "undefined" ? "http://localhost" : window.location.href);
  const idx = u.pathname.indexOf("/api/v1");
  return idx >= 0 ? u.pathname.slice(idx + "/api/v1".length) : u.pathname;
}

async function isRefreshable401(response: Response): Promise<boolean> {
  if (response.status !== 401) return false;
  try {
    const body = (await response.clone().json()) as { error?: { code?: string } };
    return !NON_REFRESHABLE_CODES.has(body?.error?.code ?? "");
  } catch {
    return true;
  }
}

function withAuth(request: Request, token: string | null): Request {
  const headers = new Headers(request.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  else headers.delete("authorization");
  return new Request(request, { headers, credentials: "include" });
}

export async function authFetch(input: Request): Promise<Response> {
  const transport = await getTransport();
  const path = apiPath(input.url);
  const skipRefresh = PUBLIC_AUTH_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  // Keep an untouched copy so the original body can be re-sent after a refresh.
  const retryCopy = skipRefresh ? null : input.clone();
  const token = skipRefresh ? null : await getAccessToken().catch(() => null);
  const response = await transport(withAuth(input, token));

  if (skipRefresh || !retryCopy || !(await isRefreshable401(response))) return response;

  const session = await refreshSession({ force: true }).catch(() => null);
  if (!session) return response; // session is gone; caller sees the original 401
  return transport(withAuth(retryCopy, session.accessToken));
}
