/**
 * Browser session: the access token lives in memory only; the refresh token is an HttpOnly cookie
 * the browser sends to `/api/v1/auth/*`. Nothing long-lived is ever written to localStorage.
 *
 * Refresh rules (see backend app/auth/router.py):
 *  - cookie refresh requires `X-CSRF-Token` equal to the (JS-readable) `agentos_csrf` cookie;
 *  - refresh tokens rotate on every use and REUSE REVOKES THE SESSION. Two tabs refreshing with the
 *    same cookie at the same moment would log the user out, so refreshes are serialized across tabs
 *    with the Web Locks API and new tokens are shared over a BroadcastChannel.
 */
import { env } from "@/lib/config/env";
import { AgentOSApiError, errorFromUnreadResponse, normalizeError } from "./errors";
import type { TokenResponse } from "./schemas";
import { getTransport } from "./transport";

export interface Session {
  accessToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  sessionId: string;
  tenantId: string;
  userId: string;
}

type Listener = () => void;
type BroadcastMessage = { type: "session"; session: Session } | { type: "signed-out" };

const REFRESH_SKEW_MS = 30_000;
const CSRF_COOKIE = "agentos_csrf";
const LOCK_NAME = "agentos-auth-refresh";
const CHANNEL_NAME = "agentos-auth";

let current: Session | null = null;
const listeners = new Set<Listener>();
let inflight: Promise<Session | null> | null = null;
let channel: BroadcastChannel | null = null;
const expiredHandlers = new Set<(reason: string) => void>();

function emit() {
  for (const l of listeners) l();
}

function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
      const msg = event.data;
      if (msg?.type === "session") {
        // Another tab refreshed or switched organization: adopt its token (same browser session).
        current = msg.session;
        emit();
      } else if (msg?.type === "signed-out") {
        current = null;
        emit();
        for (const h of expiredHandlers) h("signed_out_elsewhere");
      }
    };
  }
  return channel;
}

export function sessionFromTokenResponse(token: TokenResponse): Session {
  return {
    accessToken: token.access_token,
    expiresAt: Date.now() + token.expires_in * 1000,
    sessionId: token.session_id,
    tenantId: token.tenant_id,
    userId: token.user_id,
  };
}

export const sessionStore = {
  get(): Session | null {
    return current;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  set(session: Session, { broadcast = true }: { broadcast?: boolean } = {}) {
    current = session;
    emit();
    if (broadcast) getChannel()?.postMessage({ type: "session", session } satisfies BroadcastMessage);
  },
  clear({ broadcast = false, forgetCookie = false }: { broadcast?: boolean; forgetCookie?: boolean } = {}) {
    current = null;
    if (forgetCookie) clearCsrfCookie();
    emit();
    if (broadcast) getChannel()?.postMessage({ type: "signed-out" } satisfies BroadcastMessage);
  },
  /** Called when the session can no longer be refreshed (expired, revoked, reused). */
  onExpired(handler: (reason: string) => void): () => void {
    getChannel();
    expiredHandlers.add(handler);
    return () => expiredHandlers.delete(handler);
  },
};

export function isExpiringSoon(session: Session | null, skewMs = REFRESH_SKEW_MS): boolean {
  return !session || session.expiresAt - Date.now() <= skewMs;
}

/** Absolute API base for building Request objects (relative URLs need an origin outside the browser). */
export function apiBase(): string {
  if (env.apiIsCrossOrigin || typeof window === "undefined") return env.apiUrl;
  return `${window.location.origin}${env.apiUrl}`;
}

/**
 * Forget the CSRF cookie once the session is gone (logout, failed refresh). The backend only deletes
 * the HttpOnly refresh cookie; dropping this one avoids pointless refresh probes on the next page load
 * and keeps the /app navigation hint (src/proxy.ts) accurate.
 */
export function clearCsrfCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${CSRF_COOKIE}=; Max-Age=0; path=/; SameSite=Strict`;
}

export function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
}

/** Raw refresh call. `refreshToken` is only used once, right after registration (body → cookie). */
async function callRefresh(refreshToken?: string): Promise<Session> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  let body: string;
  if (refreshToken) {
    body = JSON.stringify({ refresh_token: refreshToken, token_delivery: "cookie" });
  } else {
    const csrf = readCsrfCookie();
    if (!csrf) {
      throw new AgentOSApiError({ status: 401, code: "no_session", message: "No active session." });
    }
    headers["x-csrf-token"] = csrf;
    body = JSON.stringify({});
  }
  let response: Response;
  try {
    const transport = await getTransport();
    response = await transport(
      new Request(`${apiBase()}/auth/refresh`, {
        method: "POST",
        headers,
        body,
        credentials: "include",
        cache: "no-store",
      }),
    );
  } catch (err) {
    throw normalizeError(err);
  }
  if (!response.ok) throw await errorFromUnreadResponse(response);
  return sessionFromTokenResponse((await response.json()) as TokenResponse);
}

async function withCrossTabLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, fn) as Promise<T>;
  }
  return fn();
}

/**
 * Obtain a fresh access token using the refresh cookie. Single-flight within the tab, serialized
 * across tabs. Resolves to null when there is no valid session (never throws for 401s);
 * throws only for transient failures (network/5xx) so callers can keep the current state.
 */
export function refreshSession(opts: { force?: boolean } = {}): Promise<Session | null> {
  if (inflight) return inflight;
  const before = current;
  inflight = withCrossTabLock(async () => {
    // Another tab may have refreshed while we waited for the lock (its token arrives via broadcast).
    if (!opts.force && current && current !== before && !isExpiringSoon(current)) return current;
    try {
      const session = await callRefresh();
      sessionStore.set(session);
      return session;
    } catch (err) {
      const apiErr = normalizeError(err);
      if (apiErr.kind === "unauthorized" || apiErr.status === 401) {
        const hadSession = current !== null;
        sessionStore.clear({ forgetCookie: true });
        if (hadSession) for (const h of expiredHandlers) h(apiErr.code);
        return null;
      }
      throw apiErr;
    }
  }).finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Registration returns tokens in the body; exchange that refresh token once for cookie delivery. */
export async function adoptBodyRefreshToken(refreshToken: string): Promise<Session> {
  return withCrossTabLock(async () => {
    const session = await callRefresh(refreshToken);
    sessionStore.set(session);
    return session;
  });
}

/** Current access token, refreshed first when it is missing or about to expire. */
export async function getAccessToken(): Promise<string | null> {
  if (current && !isExpiringSoon(current)) return current.accessToken;
  const session = await refreshSession();
  return session?.accessToken ?? null;
}
