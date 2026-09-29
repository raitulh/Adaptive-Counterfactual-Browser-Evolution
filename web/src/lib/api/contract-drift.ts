/**
 * Development-only contract drift detection: compares the fingerprint of the running backend's
 * OpenAPI document with the one the typed client was generated from. A mismatch means the types
 * may lie — the app says so loudly instead of failing mysteriously later.
 */
import { env } from "@/lib/config/env";
import { CONTRACT_FINGERPRINT } from "./generated/contract";
import { getTransport } from "./transport";

/** Same canonicalization as scripts/generate-api.mjs. */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export type DriftResult = { status: "match" } | { status: "drift"; live: string; expected: string } | { status: "unavailable" };

export async function checkContractDrift(): Promise<DriftResult> {
  if (!env.isDevelopment || env.demoMode) return { status: "match" };
  try {
    const transport = await getTransport();
    const base = env.apiIsCrossOrigin ? env.apiUrl : `${window.location.origin}${env.apiUrl}`;
    const res = await transport(new Request(`${base}/openapi.json`, { cache: "no-store" }));
    if (!res.ok) return { status: "unavailable" };
    const doc = (await res.json()) as { paths?: unknown; components?: unknown };
    const live = await sha256Hex(canonicalize({ paths: doc.paths, components: doc.components }));
    if (live === CONTRACT_FINGERPRINT) return { status: "match" };
    console.error(
      `[AgentOS] API contract drift: the backend OpenAPI document (${live.slice(0, 12)}…) differs from the ` +
        `generated client (${CONTRACT_FINGERPRINT.slice(0, 12)}…). Run \`npm run api:generate\` ` +
        `(with OPENAPI_SOURCE pointing at the running backend) and fix the type errors it reveals.`,
    );
    return { status: "drift", live, expected: CONTRACT_FINGERPRINT };
  } catch {
    return { status: "unavailable" };
  }
}
