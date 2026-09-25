import { env } from "@/lib/env";

export const siteConfig = {
  name: env.NEXT_PUBLIC_PRODUCT_NAME,
  positioning: "Human Verification Infrastructure for the AI Era",
  tagline: "Human verification infrastructure for the AI era.",
  description:
    "Signal-based human verification for websites, SaaS products, APIs, marketplaces and communities. API-first, privacy-minded, and built for a web shared with AI agents.",
  url: env.NEXT_PUBLIC_SITE_URL,
  githubUrl: env.NEXT_PUBLIC_GITHUB_URL,
} as const;

export const routes = {
  home: "/",
  demo: "/#demo",
  docs: "/docs",
  login: "/login",
  signup: "/login?mode=signup",
  dashboard: "/dashboard",
} as const;

export interface NavItem {
  label: string;
  href: string;
  /** Section id on the home page used for the active-link indicator. */
  sectionId?: string;
}

export const primaryNav: readonly NavItem[] = [
  { label: "Product", href: "/#product", sectionId: "product" },
  { label: "Developers", href: "/#developers", sectionId: "developers" },
  { label: "Security", href: "/#security", sectionId: "security" },
  { label: "Pricing", href: "/#pricing", sectionId: "pricing" },
  { label: "Docs", href: "/docs" },
];

export const footerNav: readonly { title: string; links: readonly NavItem[] }[] = [
  {
    title: "Product",
    links: [
      { label: "How it works", href: "/#product" },
      { label: "Live demo", href: "/#demo" },
      { label: "Dashboard", href: "/dashboard" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "API", href: "/#developers" },
      { label: "Quickstart", href: "/docs#quickstart" },
      { label: "API reference", href: "/docs#api-reference" },
    ],
  },
  {
    title: "Security",
    links: [
      { label: "Security & privacy", href: "/#security" },
      { label: "Data processing", href: "/docs#privacy" },
    ],
  },
  {
    title: "Docs",
    links: [
      { label: "Documentation", href: "/docs" },
      { label: "Mock mode", href: "/docs#mock-mode" },
    ],
  },
  {
    title: "Pricing",
    links: [
      { label: "Plans", href: "/#pricing" },
      { label: "FAQ", href: "/#faq" },
    ],
  },
];
