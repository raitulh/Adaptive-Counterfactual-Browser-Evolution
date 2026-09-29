/**
 * Auth in demo mode: the demo user is always signed in. Login/registration accept any well-formed
 * input and return the demo session; refresh works without cookies; Google sign-in "completes"
 * through the app's own callback page — no external navigation, no real credentials.
 */
import type { TokenResponse } from "@/lib/api";
import { Body, type Ctx, DemoHttpError, json, noContent, notFound } from "../http";
import type { Router, Srv } from "../router";
import type { DemoStore } from "../store";
import { randomToken } from "../util";

const ACCESS_TTL = 900;
const STREAM_TTL = 120;

/** What the backend's Set-Cookie would do: the JS-readable CSRF cookie that marks a browser session. */
function setCsrfCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `agentos_csrf=${randomToken("demo-csrf").slice(0, 32)}; path=/; SameSite=Strict`;
}

export function issueSession(store: DemoStore, delivery: "body" | "cookie"): TokenResponse {
  const access = randomToken("demo-at");
  store.auth.accessTokens.add(access);
  let refresh: string | null = null;
  if (delivery === "body") {
    refresh = randomToken("demo-rt");
    store.auth.refreshTokens.add(refresh);
  } else {
    setCsrfCookie();
  }
  store.auth.signedOut = false;
  return {
    access_token: access,
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    session_id: store.auth.sessionId,
    tenant_id: store.org.id,
    user_id: store.me.id,
    token_type: "bearer",
  };
}

function signOut(store: DemoStore): void {
  store.auth.signedOut = true;
  store.auth.accessTokens.clear();
  store.auth.refreshTokens.clear();
  store.auth.streamTokens.clear();
}

async function login(ctx: Ctx, { store }: Srv) {
  const b = new Body(await ctx.json());
  b.email("email");
  b.str("password", { min: 1, max: 256 });
  b.optStr("mfa_code", { max: 12 });
  b.optStr("device_name", { max: 200 });
  const delivery = b.optEnum("token_delivery", ["body", "cookie"] as const) ?? "body";
  b.done();
  const token = issueSession(store, delivery);
  store.me.last_login_at = store.nowIso();
  store.audit({ category: "auth", action: "auth.login", metadata: { method: "password" } }, ctx.requestId);
  return json(ctx, 200, token);
}

async function register(ctx: Ctx, { store }: Srv) {
  const b = new Body(await ctx.json());
  b.email("email");
  const password = b.str("password", { min: 10, max: 256 });
  if (password.length >= 10) {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
    if (classes < 3)
      b.fail("password", "Value error, password must mix at least three of: lowercase, uppercase, digits, symbols");
  }
  b.optStr("display_name", { max: 200 });
  b.optStr("organization_name", { max: 200 });
  b.optStr("timezone", { max: 64 });
  b.done();
  // Registration returns tokens in the body (the client then trades the refresh token for a cookie).
  return json(ctx, 201, issueSession(store, "body"));
}

async function refresh(ctx: Ctx, { store }: Srv) {
  const b = new Body(await ctx.json(), { optional: true });
  const token = b.optStr("refresh_token");
  const delivery = b.optEnum("token_delivery", ["body", "cookie"] as const) ?? "body";
  b.done();
  if (token) {
    if (!store.auth.refreshTokens.delete(token)) {
      throw new DemoHttpError(
        401,
        "invalid_refresh_token",
        "The refresh token is invalid, expired or was already used",
      );
    }
    return json(ctx, 200, issueSession(store, delivery));
  }
  if (store.auth.signedOut) throw new DemoHttpError(401, "unauthorized", "Missing refresh token");
  return json(ctx, 200, issueSession(store, "cookie"));
}

function sessions(ctx: Ctx, { store }: Srv) {
  return json(
    ctx,
    200,
    store.sessions
      .filter((s) => !s.revoked_at)
      .map((s) => ({
        ...s,
        current: s.id === store.auth.sessionId,
        last_seen_at: s.id === store.auth.sessionId ? store.nowIso() : s.last_seen_at,
      })),
  );
}

function revokeSession(ctx: Ctx, { store }: Srv) {
  const session = store.sessions.find((s) => s.id === ctx.params.session_id && !s.revoked_at);
  if (!session) throw notFound("Session not found");
  session.revoked_at = store.nowIso();
  if (session.id === store.auth.sessionId) signOut(store);
  store.audit(
    { category: "auth", action: "auth.session.revoke", resource_type: "session", resource_id: session.id },
    ctx.requestId,
  );
  return noContent(ctx);
}

async function switchOrganization(ctx: Ctx, { store }: Srv) {
  const b = new Body(await ctx.json());
  const orgId = b.uuid("organization_id");
  b.done();
  if (orgId !== store.org.id) throw notFound("Organization not found");
  const access = randomToken("demo-at");
  store.auth.accessTokens.add(access);
  const out: TokenResponse = {
    access_token: access,
    expires_in: ACCESS_TTL,
    session_id: store.auth.sessionId,
    tenant_id: store.org.id,
    user_id: store.me.id,
    token_type: "bearer",
    refresh_token: null,
  };
  return json(ctx, 200, out);
}

function googleStart(ctx: Ctx, { store }: Srv) {
  const state = randomToken("demo-state").slice(0, 40);
  store.auth.oauthStates.add(state);
  // Google is simulated: "consent" is immediate and lands on the app's own callback page.
  const authorization_url = `/callback/google?${new URLSearchParams({ code: "demo-google-code", state })}`;
  return json(ctx, 200, { authorization_url, state });
}

function googleCallback(ctx: Ctx, { store }: Srv) {
  const state = ctx.query.get("state") ?? "";
  const code = ctx.query.get("code");
  if (!code)
    throw new DemoHttpError(422, "validation_failed", "The request is invalid.", {
      errors: [{ loc: ["query", "code"], msg: "Field required", type: "missing" }],
    });
  if (!store.auth.oauthStates.delete(state))
    throw new DemoHttpError(401, "unauthorized", "OAuth state is invalid or expired");
  const delivery = ctx.query.get("token_delivery") === "body" ? "body" : "cookie";
  store.audit({ category: "auth", action: "auth.login", metadata: { method: "google" } }, ctx.requestId);
  return json(ctx, 200, issueSession(store, delivery));
}

export function authRoutes(r: Router): void {
  r.add("POST", "/auth/login", login, { public: true })
    .add("POST", "/auth/register", register, { public: true })
    .add("POST", "/auth/refresh", refresh, { public: true })
    .add("POST", "/auth/logout", (ctx, { store }) => {
      signOut(store);
      store.audit({ category: "auth", action: "auth.logout" }, ctx.requestId);
      return noContent(ctx);
    })
    .add("POST", "/auth/logout-all", (ctx, { store }) => {
      for (const s of store.sessions) s.revoked_at ??= store.nowIso();
      signOut(store);
      store.audit({ category: "auth", action: "auth.logout_all" }, ctx.requestId);
      return noContent(ctx);
    })
    .add("GET", "/auth/sessions", sessions)
    .add("DELETE", "/auth/sessions/{session_id}", revokeSession)
    .add("POST", "/auth/switch-organization", switchOrganization)
    .add("POST", "/auth/stream-token", (ctx, { store }) => {
      const token = randomToken("demo-st");
      store.auth.streamTokens.set(token, Date.now() + STREAM_TTL * 1000);
      return json(ctx, 200, { token, expires_in: STREAM_TTL });
    })
    .add("GET", "/auth/oauth/google/start", googleStart, { public: true })
    .add("GET", "/auth/oauth/google/callback", googleCallback, { public: true })
    .unavailable(
      "POST",
      "/auth/password/change",
      "Passwords cannot be changed in the demo — the demo user is always signed in.",
    )
    .unavailable("POST", "/auth/mfa/enroll", "Two-factor authentication cannot be set up in the demo.")
    .unavailable("POST", "/auth/mfa/{factor_id}/confirm", "Two-factor authentication cannot be set up in the demo.")
    .unavailable("POST", "/auth/mfa/disable", "Two-factor authentication cannot be set up in the demo.");
}

/** SSE endpoints authenticate with a short-lived stream token in `?access_token=`. */
export function requireStreamToken(ctx: Ctx, store: DemoStore): void {
  const token = ctx.query.get("access_token");
  const expires = token ? store.auth.streamTokens.get(token) : undefined;
  if (store.auth.signedOut || expires === undefined || expires < Date.now()) {
    throw new DemoHttpError(401, "unauthorized", "A valid stream token is required");
  }
}
