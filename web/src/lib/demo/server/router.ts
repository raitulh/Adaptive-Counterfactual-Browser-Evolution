/**
 * Route table + dispatch. Paths are matched after `/api/v1`; `{name}` segments become params and
 * every `*_id` param is validated as a UUID (FastAPI answers malformed UUIDs with 422).
 *
 * Contract endpoints the demo does not simulate answer 501 `not_available_in_demo` — never a fake
 * success. Paths outside the contract answer 404, wrong methods 405, like the real API.
 */
import type { DemoEngine } from "./engine";
import { createCtx, type Ctx, DemoHttpError, errorResponse, invalid, notAvailable } from "./http";
import type { DemoStore } from "./store";
import { isUuid } from "./util";

export interface Srv {
  store: DemoStore;
  engine: DemoEngine;
}

export type Handler = (ctx: Ctx, srv: Srv) => Response | Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
  /** No bearer token needed (public auth endpoints, health, SSE with stream tokens). */
  public: boolean;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler, opts: { public?: boolean } = {}): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler, public: opts.public ?? false });
    return this;
  }

  /** Declare contract endpoints that exist in the real API but are not simulated in the demo. */
  unavailable(method: string, pattern: string, message?: string): this {
    return this.add(
      method,
      pattern,
      () => {
        throw notAvailable(message);
      },
      { public: true },
    );
  }

  match(method: string, path: string): { route: Route; params: Record<string, string> } | "method_not_allowed" | null {
    const parts = path.split("/").filter(Boolean);
    let pathMatched = false;
    // Literal segments win over params (e.g. /evaluations/suites before /evaluations/{run_id}).
    const candidates = this.routes
      .map((route) => ({ route, params: matchSegments(route.segments, parts) }))
      .filter((c): c is { route: Route; params: Record<string, string> } => c.params !== null)
      .sort((a, b) => Object.keys(a.params).length - Object.keys(b.params).length);
    for (const c of candidates) {
      pathMatched = true;
      if (c.route.method === method) return c;
    }
    return pathMatched ? "method_not_allowed" : null;
  }
}

function matchSegments(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p.startsWith("{") && p.endsWith("}")) params[p.slice(1, -1)] = decodeURIComponent(parts[i]);
    else if (p !== parts[i]) return null;
  }
  return params;
}

function apiPath(url: string): string {
  const pathname = new URL(url).pathname;
  const idx = pathname.indexOf("/api/v1");
  return idx >= 0 ? pathname.slice(idx + "/api/v1".length) || "/" : pathname;
}

export async function dispatch(router: Router, srv: Srv, request: Request): Promise<Response> {
  const ctx = createCtx(request, apiPath(request.url));
  try {
    const found = router.match(ctx.method, ctx.path);
    if (found === null) throw new DemoHttpError(404, "not_found", "Not Found");
    if (found === "method_not_allowed") throw new DemoHttpError(405, "method_not_allowed", "Method Not Allowed");
    const issues = Object.entries(found.params)
      .filter(([name, value]) => name.endsWith("_id") && !isUuid(value))
      .map(([name]) => ({ loc: ["path", name], msg: "Input should be a valid UUID", type: "uuid_parsing" }));
    if (issues.length) throw invalid(issues);
    ctx.params = found.params;
    if (!found.route.public) authenticate(ctx, srv.store);
    return await found.route.handler(ctx, srv);
  } catch (err) {
    if (err instanceof DemoHttpError) return errorResponse(err, ctx.requestId);
    console.error("[demo backend] unhandled error", err);
    return errorResponse(new DemoHttpError(500, "internal_error", "An internal error occurred."), ctx.requestId);
  }
}

/** The demo user is always signed in — unless they explicitly signed out in this page session. */
function authenticate(ctx: Ctx, store: DemoStore): void {
  if (store.auth.signedOut) throw new DemoHttpError(401, "unauthorized", "Not authenticated");
  const header = ctx.header("authorization");
  if (header) {
    const token = header.replace(/^Bearer\s+/i, "");
    if (!store.auth.accessTokens.has(token))
      throw new DemoHttpError(401, "token_expired", "The access token is invalid or expired");
  }
}
