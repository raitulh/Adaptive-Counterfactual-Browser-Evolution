import type { MetadataRoute } from "next";
import { env } from "@/lib/config/env";

/** Public, indexable routes only (the product under /app and auth pages are excluded). */
const PUBLIC_ROUTES: Array<{ path: string; priority: number; changeFrequency: "weekly" | "monthly" }> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/product", priority: 0.9, changeFrequency: "monthly" },
  { path: "/security", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pricing", priority: 0.8, changeFrequency: "weekly" },
  { path: "/docs", priority: 0.7, changeFrequency: "weekly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return PUBLIC_ROUTES.map((r) => ({
    url: `${env.siteUrl}${r.path === "/" ? "" : r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
