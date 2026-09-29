import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentOSApiError, errorFromResponse, normalizeError } from "@/lib/api/errors";
import { authFetch } from "@/lib/api/http";
import { refreshSession, sessionStore } from "@/lib/api/session";
import { sanitizeProps } from "@/lib/analytics";

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const envelope = (code: string, message = "m", details: Record<string, unknown> = {}) => ({
  error: { code, message, request_id: "req-123", details },
});

describe("AgentOSApiError", () => {
  it("normalizes the backend envelope", () => {
    const err = errorFromResponse(json(422, {}), envelope("request_validation", "Invalid", { errors: [{ loc: ["body", "goal"], msg: "Field required", type: "missing" }] }));
    expect(err.kind).toBe("validation");
    expect(err.requestId).toBe("req-123");
    expect(err.fieldErrors).toEqual({ goal: "Field required" });
  });

  it("never reveals whether hidden resources exist and reports missing permissions", () => {
    const forbidden = errorFromResponse(json(403, {}), envelope("forbidden", "x", { missing_permissions: ["audit:read"] }));
    expect(forbidden.userMessage).toMatch(/permission/i);
    expect(forbidden.missingPermissions).toEqual(["audit:read"]);
    const notFound = errorFromResponse(json(404, {}), envelope("not_found", "Task 123 belongs to org X"));
    expect(notFound.userMessage).not.toContain("org X");
  });

  it("reads Retry-After for rate limits and never shows raw non-envelope bodies", () => {
    const limited = errorFromResponse(json(429, {}, { "retry-after": "7" }), envelope("rate_limited"));
    expect(limited.retryAfterSeconds).toBe(7);
    expect(limited.isRetryable).toBe(true);
    const html = errorFromResponse(new Response("<html>stack trace</html>", { status: 500, statusText: "Internal Server Error" }), null);
    expect(html.userMessage).not.toContain("stack");
    expect(normalizeError(new TypeError("fetch failed")).kind).toBe("network");
  });
});

describe("authFetch / session", () => {
  const fetchMock = vi.fn<(input: Request) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    document.cookie = "agentos_csrf=csrf-token; path=/";
    sessionStore.clear();
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    sessionStore.clear();
  });

  const tokenResponse = (token: string) => ({
    access_token: token,
    expires_in: 900,
    session_id: "s",
    tenant_id: "t",
    user_id: "u",
    token_type: "bearer",
    refresh_token: null,
  });

  it("refreshes once on 401, then retries the original request with the new token", async () => {
    sessionStore.set({ accessToken: "old", expiresAt: Date.now() + 600_000, sessionId: "s", tenantId: "t", userId: "u" });
    fetchMock.mockImplementation(async (req: Request) => {
      if (req.url.endsWith("/auth/refresh")) {
        expect(req.headers.get("x-csrf-token")).toBe("csrf-token");
        return json(200, tokenResponse("new"));
      }
      const auth = req.headers.get("authorization");
      if (auth === "Bearer old") return json(401, envelope("token_expired"));
      expect(await req.json()).toEqual({ goal: "g" }); // body preserved for the retry
      return json(202, { ok: true });
    });
    const res = await authFetch(new Request("http://localhost:3000/api/v1/tasks", { method: "POST", body: JSON.stringify({ goal: "g" }) }));
    expect(res.status).toBe(202);
    expect(sessionStore.get()?.accessToken).toBe("new");
    expect(fetchMock.mock.calls.map(([r]) => new URL(r.url).pathname)).toEqual(["/api/v1/tasks", "/api/v1/auth/refresh", "/api/v1/tasks"]);
  });

  it("does not loop: auth endpoints are never refresh-retried", async () => {
    fetchMock.mockResolvedValue(json(401, envelope("invalid_credentials")));
    const res = await authFetch(new Request("http://localhost:3000/api/v1/auth/login", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("wrong-credential 401s are returned as-is, and a failed refresh clears the session", async () => {
    sessionStore.set({ accessToken: "old", expiresAt: Date.now() + 600_000, sessionId: "s", tenantId: "t", userId: "u" });
    const expired = vi.fn();
    const off = sessionStore.onExpired(expired);
    fetchMock.mockImplementation(async (req: Request) =>
      req.url.endsWith("/auth/refresh") ? json(401, envelope("session_expired")) : json(401, envelope("token_expired")),
    );
    const res = await authFetch(new Request("http://localhost:3000/api/v1/users/me"));
    expect(res.status).toBe(401);
    expect(sessionStore.get()).toBeNull();
    expect(expired).toHaveBeenCalledWith("session_expired");
    off();
  });

  it("single-flights concurrent refreshes", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 10));
      return json(200, tokenResponse(`t${calls}`));
    });
    const [a, b, c] = await Promise.all([refreshSession(), refreshSession(), refreshSession()]);
    expect(calls).toBe(1);
    expect(a?.accessToken).toBe("t1");
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("returns null without a network call when there is no session cookie", async () => {
    document.cookie = "agentos_csrf=; Max-Age=0; path=/";
    await expect(refreshSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces AgentOSApiError instances for thrown network errors", () => {
    expect(normalizeError(new DOMException("aborted", "AbortError"))).toBeInstanceOf(AgentOSApiError);
  });
});

describe("analytics privacy", () => {
  it("drops sensitive keys and free text", () => {
    expect(sanitizeProps({ goal: "secret plan", tool: "gmail.send", count: 3, note: "x", long: "x".repeat(100) })).toEqual({
      tool: "gmail.send",
      count: 3,
    });
  });
});
