/**
 * Network transport for every API call (typed client, session refresh, uploads, SSE).
 * In demo mode the in-browser demo backend answers instead of the network — explicitly opt-in via
 * NEXT_PUBLIC_DEMO_MODE and visibly labelled in the UI; production builds never fall back to it.
 */
import { env } from "@/lib/config/env";

export type Transport = (input: Request) => Promise<Response>;

// Always call fetch through a wrapper: a detached `window.fetch` reference throws "Illegal invocation".
const networkTransport: Transport = (input) => globalThis.fetch(input);

let demoTransport: Transport | null = null;

export async function getTransport(): Promise<Transport> {
  if (!env.demoMode) return networkTransport;
  if (!demoTransport) {
    const mod = await import("@/lib/demo/backend");
    demoTransport = mod.demoFetch;
  }
  return demoTransport;
}
