/**
 * In-browser demo backend (NEXT_PUBLIC_DEMO_MODE=true only).
 *
 * `demoFetch` answers every AgentOS API request — typed client, session refresh, uploads and SSE —
 * with an in-memory, stateful simulation of the real API: same paths, methods, status codes, bodies,
 * error envelope, cursor pagination, Idempotency-Key replay and SSE framing. Tasks really run
 * (planning, approvals, input requests, retries, verification) with realistic timings; nothing is
 * ever sent over the network. Endpoints the demo does not simulate answer 501
 * `not_available_in_demo` instead of pretending to succeed.
 *
 * Loaded only through the dynamic import in `@/lib/api/transport`, so none of this is in the
 * critical path of production (API-mode) bundles.
 */
import { env } from "@/lib/config/env";
import { configureDemoClock, type DemoConfig } from "./server/clock";
import { createDemoServer, type DemoServer } from "./server";

export { DEMO_GOALS } from "./server/scenarios";

let server: DemoServer | null = null;

function assertDemoMode(): void {
  if (!env.demoMode) {
    throw new Error("The AgentOS demo backend only runs with NEXT_PUBLIC_DEMO_MODE=true.");
  }
}

function getServer(): DemoServer {
  assertDemoMode();
  server ??= createDemoServer();
  return server;
}

/** The demo transport: `(Request) => Promise<Response>`, the same contract as `fetch`. */
export async function demoFetch(request: Request): Promise<Response> {
  return getServer().handle(request);
}

/** Tune the simulation (e.g. `timeScale: 0.01` makes every latency 100× shorter — used by tests). */
export function configureDemo(config: Partial<DemoConfig>): void {
  assertDemoMode();
  configureDemoClock(config);
}

/** Discard all demo state; the next request starts from a freshly seeded workspace. */
export function resetDemoBackend(): void {
  assertDemoMode();
  server = null;
}
