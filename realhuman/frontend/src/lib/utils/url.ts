/**
 * Strict URL helpers for any link whose value does not come from source code
 * (environment variables, API responses, user input).
 */

const SAFE_PROTOCOLS = new Set(["https:"]);
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Returns a normalized absolute URL when `raw` is an https URL (or http on a
 * loopback host), otherwise `null`. Rejects javascript:, data:, credentials in
 * the URL, and malformed input.
 */
export function toSafeExternalUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  const isLoopbackHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (!SAFE_PROTOCOLS.has(url.protocol) && !isLoopbackHttp) return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** True for same-origin paths and in-page anchors such as `/docs` or `/#pricing`. */
export function isInternalHref(href: string): boolean {
  return href.startsWith("/") && !href.startsWith("//");
}

/**
 * A post-login redirect target, accepted only when it points inside the
 * dashboard (prevents open redirects via `?next=`).
 */
export function safeDashboardPath(next: string | undefined): string | undefined {
  if (!next || !isInternalHref(next) || next.includes("\\")) return undefined;
  return next === "/dashboard" || next.startsWith("/dashboard/") || next.startsWith("/dashboard?")
    ? next
    : undefined;
}

/** Joins a base URL and a path without producing duplicate slashes. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
