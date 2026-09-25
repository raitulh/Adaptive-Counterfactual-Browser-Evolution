import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/constants/site";

export default function sitemap(): MetadataRoute.Sitemap {
  // Sitemaps require absolute URLs, so they are only emitted for a configured domain.
  if (!siteConfig.url) return [];
  const base = siteConfig.url.replace(/\/$/, "");
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/docs`, changeFrequency: "weekly", priority: 0.8 },
  ];
}
