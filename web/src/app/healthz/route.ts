/**
 * Liveness of the web tier itself (container healthchecks, load balancers). Deliberately does not
 * call the API: backend health is reported by the backend's own /api/v1/ready.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": "no-store" } });
}
