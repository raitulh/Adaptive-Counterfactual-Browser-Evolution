/**
 * Typed, validated public configuration. NEXT_PUBLIC_* values are inlined at build time.
 * Misconfiguration fails loudly instead of producing a half-working app.
 */

function normalizeApiUrl(raw: string | undefined): string {
  const value = (raw && raw.trim()) || "/api/v1";
  const trimmed = value.replace(/\/+$/, "");
  if (!trimmed.endsWith("/api/v1")) {
    throw new Error(`NEXT_PUBLIC_API_URL must end with /api/v1 (got "${value}")`);
  }
  return trimmed;
}

const apiUrl = normalizeApiUrl(process.env.NEXT_PUBLIC_API_URL);

export const env = {
  /** Base URL of the AgentOS API as seen by the browser, e.g. "/api/v1" or "https://api.x.com/api/v1". */
  apiUrl,
  /** Prefix that precedes "/api/v1" (empty for the same-origin pass-through). */
  apiOrigin: apiUrl.slice(0, -"/api/v1".length),
  /** True when the browser calls the API on another origin (cookies must be configured for the site). */
  apiIsCrossOrigin: /^https?:\/\//.test(apiUrl),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/+$/, ""),
  demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true",
  analyticsProvider: (process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER || "none") as "none" | "console",
  isDevelopment: process.env.NODE_ENV === "development",
  isTest: process.env.NODE_ENV === "test",
} as const;
