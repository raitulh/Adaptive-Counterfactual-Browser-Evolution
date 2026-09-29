/**
 * Same-origin pass-through to the AgentOS API (`/api/v1/*` → `${AGENTOS_API_ORIGIN}/api/v1/*`).
 *
 * Why a pass-through instead of calling the API cross-origin:
 *  - the HttpOnly refresh cookie and the double-submit CSRF cookie are first-party for the web
 *    app (SameSite=Strict works, JS can read the CSRF cookie, no third-party-cookie issues);
 *  - no CORS preflights; one origin for CSP;
 *  - the upstream origin is read at request time, so one production build runs anywhere.
 *
 * This is transport only: no business logic, no auth decisions, no response rewriting. Bodies are
 * streamed in both directions (file uploads, Server-Sent Events). Deployments that prefer calling
 * the API directly set NEXT_PUBLIC_API_URL to an absolute URL and this handler is unused.
 */
import type { NextRequest } from "next/server";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

function upstreamOrigin(): string {
  return (process.env.AGENTOS_API_ORIGIN ?? "http://localhost:8000").replace(/\/+$/, "");
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message, request_id: null, details: {} } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function forward(request: NextRequest, ctx: RouteContext<"/api/v1/[...path]">): Promise<Response> {
  const { path } = await ctx.params;
  const target = new URL(`${upstreamOrigin()}/api/v1/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key)) headers.set(key, value);
  });
  // Preserve the client's address chain for per-IP rate limits. The API must trust this hop
  // (uvicorn --proxy-headers --forwarded-allow-ips=<web tier address>).
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) headers.set("x-forwarded-for", forwardedFor);
  headers.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  const host = request.headers.get("host");
  if (host) headers.set("x-forwarded-host", host);

  const method = request.method.toUpperCase();
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    redirect: "manual", // OAuth callbacks answer with 302s the browser must follow itself
    signal: request.signal, // client disconnects (e.g. closed SSE) abort the upstream request
    cache: "no-store",
  };
  if (method !== "GET" && method !== "HEAD" && request.body) {
    init.body = request.body;
    init.duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    console.error("[api-proxy] upstream unreachable", { path: target.pathname, error: (err as Error).name });
    return errorEnvelope(502, "api_unreachable", "The AgentOS API is unreachable. Please try again shortly.");
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    // fetch() already decoded the body, so the original encoding/length no longer apply.
    if (HOP_BY_HOP.has(key) || key === "set-cookie" || key === "content-encoding") return;
    out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  if ((upstream.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
    // no-transform: never compress or buffer an event stream on the way to the browser.
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
