import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/**
 * The live verification API origin must be allowed by `connect-src`,
 * otherwise the browser blocks requests from the real adapter.
 */
function apiOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

/**
 * A conservative Content-Security-Policy. Next.js injects inline bootstrap
 * scripts, so without a nonce-based setup `'unsafe-inline'` is required for
 * scripts. Everything else is locked to the site origin.
 */
function contentSecurityPolicy(): string {
  const connect = ["'self'", apiOrigin(), isDev ? "ws: wss:" : ""].filter(Boolean).join(" ");
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob:",
    "font-src": "'self'",
    "connect-src": connect,
    "worker-src": "'self' blob:",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  };
  return Object.entries(directives)
    .map(([key, value]) => `${key} ${value}`)
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
