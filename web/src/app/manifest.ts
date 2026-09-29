import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AgentOS",
    short_name: "AgentOS",
    description:
      "Give AI a goal. AgentOS plans, executes, verifies and improves real-world tasks across the tools you use.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#07080a",
    theme_color: "#07080a",
    categories: ["productivity", "business"],
    icons: [
      { src: "/icon/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon/maskable", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
