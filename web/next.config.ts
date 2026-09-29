import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Baseline CSP that needs no per-request nonces (pages stay statically optimizable): no plugins,
// no framing, no <base> hijacking, forms post only to this origin.
const contentSecurityPolicy = [
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Browsers ignore HSTS over plain HTTP, so local `next start` is unaffected.
  ...(isProduction ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Dev server only: allow opening the app via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],
  // Self-contained server output for container images (see README → Deployment).
  output: "standalone",
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The authenticated application is never indexed.
      { source: "/app/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      { source: "/callback/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "radix-ui"],
  },
};

export default nextConfig;
