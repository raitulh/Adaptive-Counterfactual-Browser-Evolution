import type { MetadataRoute } from "next";
import { env } from "@/lib/config/env";

/**
 * Public marketing pages are crawlable; the product, the API pass-through and OAuth callbacks are not.
 * `/app/` + `/app$` (not a bare `/app` prefix, which would also match `/apple-icon`).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app$", "/app/", "/api/", "/callback/"],
      },
    ],
    sitemap: `${env.siteUrl}/sitemap.xml`,
  };
}
