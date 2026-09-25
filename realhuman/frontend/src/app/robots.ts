import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/constants/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/login"] },
    ...(siteConfig.url ? { sitemap: `${siteConfig.url.replace(/\/$/, "")}/sitemap.xml` } : {}),
  };
}
