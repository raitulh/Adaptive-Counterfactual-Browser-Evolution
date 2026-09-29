import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adoptBodyRefreshToken, readCsrfCookie, refreshSession, sessionStore, type Session } from "@/lib/api/session";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const tokenResponse = (token: string) => ({
  access_token: token,
  expires_in: 900,
  session_id: "s",
  tenant_id: "t",
  user_id: "u",
  token_type: "bearer",
  refresh_token: null,
});

function nextMessage(): Promise<void> {
  return new Promise((r) => setTimeout(r, 20));
}

describe("session lifecycle", () => {
  const fetchMock = vi.fn<(input: Request) => Promise<Response>>();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "agentos_csrf=csrf-1; path=/";
    sessionStore.clear();
  });
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
    sessionStore.clear();
  });

  it("exchanges the registration refresh token for the cookie form once, and stores nothing", async () => {
    fetchMock.mockImplementation(async (req: Request) => {
      expect(new URL(req.url).pathname).toBe("/api/v1/auth/refresh");
      expect(await req.json()).toEqual({ refresh_token: "body-refresh-token", token_delivery: "cookie" });
      expect(req.headers.get("x-csrf-token")).toBeNull();
      return json(200, tokenResponse("access-1"));
    });
    const session = await adoptBodyRefreshToken("body-refresh-token");
    expect(session.accessToken).toBe("access-1");
    expect(sessionStore.get()?.accessToken).toBe("access-1");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("body-refresh-token");
    expect(JSON.stringify({ ...localStorage, ...sessionStorage })).not.toContain("access-1");
  });

  it("refreshes with the CSRF double-submit header and the cookie (credentials: include)", async () => {
    fetchMock.mockImplementation(async (req: Request) => {
      expect(req.headers.get("x-csrf-token")).toBe("csrf-1");
      expect(req.credentials).toBe("include");
      return json(200, tokenResponse("access-2"));
    });
    await expect(refreshSession()).resolves.toMatchObject({ accessToken: "access-2" });
  });

  it("a rejected refresh ends the session everywhere in this tab and forgets the CSRF cookie", async () => {
    sessionStore.set({ accessToken: "old", expiresAt: Date.now() + 1000, sessionId: "s", tenantId: "t", userId: "u" });
    const expired = vi.fn();
    const off = sessionStore.onExpired(expired);
    fetchMock.mockResolvedValue(json(401, { error: { code: "refresh_reused", message: "m", request_id: null, details: {} } }));
    await expect(refreshSession()).resolves.toBeNull();
    expect(sessionStore.get()).toBeNull();
    expect(readCsrfCookie()).toBeNull();
    expect(expired).toHaveBeenCalledWith("refresh_reused");
    off();
  });

  it("transient refresh failures keep the current session (no forced sign-out on a blip)", async () => {
    const session: Session = { accessToken: "keep", expiresAt: Date.now() + 1000, sessionId: "s", tenantId: "t", userId: "u" };
    sessionStore.set(session);
    fetchMock.mockResolvedValue(json(503, { error: { code: "unavailable", message: "m", request_id: null, details: {} } }));
    await expect(refreshSession()).rejects.toMatchObject({ kind: "unavailable" });
    expect(sessionStore.get()).toEqual(session);
  });

  it("serializes refreshes across tabs with a Web Lock", async () => {
    const request = vi.fn((_name: string, _opts: unknown, fn: () => Promise<unknown>) => fn());
    vi.stubGlobal("navigator", { ...navigator, locks: { request } });
    fetchMock.mockResolvedValue(json(200, tokenResponse("access-3")));
    await refreshSession();
    expect(request).toHaveBeenCalledWith("agentos-auth-refresh", { mode: "exclusive" }, expect.any(Function));
  });

  it("follows other tabs: adopts their refreshed token and signs out when they sign out", async () => {
    const expired = vi.fn();
    const off = sessionStore.onExpired(expired); // also opens this tab's channel
    const otherTab = new BroadcastChannel("agentos-auth");
    const shared: Session = { accessToken: "from-other-tab", expiresAt: Date.now() + 600_000, sessionId: "s", tenantId: "t2", userId: "u" };

    otherTab.postMessage({ type: "session", session: shared });
    await nextMessage();
    expect(sessionStore.get()).toEqual(shared);

    otherTab.postMessage({ type: "signed-out" });
    await nextMessage();
    expect(sessionStore.get()).toBeNull();
    expect(expired).toHaveBeenCalledWith("signed_out_elsewhere");

    otherTab.close();
    off();
  });
});
