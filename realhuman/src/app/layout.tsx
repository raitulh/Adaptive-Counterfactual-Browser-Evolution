import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { siteConfig } from "@/lib/constants/site";
import { cn } from "@/lib/utils/cn";
import "./globals.css";

const title = `${siteConfig.name} — ${siteConfig.positioning}`;

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url ?? "http://localhost:3000"),
  title: { default: title, template: `%s · ${siteConfig.name}` },
  description: siteConfig.description,
  applicationName: siteConfig.name,
  keywords: [
    "human verification",
    "bot detection",
    "CAPTCHA alternative",
    "AI agents",
    "risk-based verification",
    "verification API",
  ],
  openGraph: {
    type: "website",
    siteName: siteConfig.name,
    title,
    description: siteConfig.description,
    ...(siteConfig.url ? { url: siteConfig.url } : {}),
  },
  twitter: {
    card: "summary_large_image",
    title,
    description: siteConfig.description,
  },
  ...(siteConfig.url ? { alternates: { canonical: "/" } } : {}),
};

export const viewport: Viewport = {
  themeColor: "#060709",
  colorScheme: "dark",
};

// Keeps scroll-revealed content visible when JavaScript is unavailable.
const NO_SCRIPT_STYLES =
  "<style>[data-reveal]{opacity:1!important;transform:none!important}[data-meter]{transform:scaleX(var(--value))!important}</style>";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={cn(GeistSans.variable, GeistMono.variable)}
    >
      <body>
        <noscript dangerouslySetInnerHTML={{ __html: NO_SCRIPT_STYLES }} />
        <a
          href="#main"
          className="sr-only z-(--z-tooltip) rounded-md bg-inverse px-4 py-2 text-sm font-medium text-inverse-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
