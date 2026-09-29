import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { env } from "@/lib/config/env";
import { Providers } from "./providers";
import "./globals.css";

// Self-hosted variable fonts (no network access needed at build time).
const interTight = localFont({
  src: "../../node_modules/@fontsource-variable/inter-tight/files/inter-tight-latin-wght-normal.woff2",
  variable: "--font-inter-tight",
  weight: "100 900",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains-mono",
  weight: "100 800",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: "AgentOS — Give AI a goal. AgentOS gets the work done.",
    template: "%s · AgentOS",
  },
  description:
    "AgentOS is an autonomous agent operating system: it plans, executes, verifies and recovers real work across Gmail, Calendar, Drive, the web and your tools — with approvals and a full audit trail.",
  applicationName: "AgentOS",
  openGraph: {
    type: "website",
    siteName: "AgentOS",
    title: "AgentOS — Give AI a goal. AgentOS gets the work done.",
    description: "Plan, execute, verify and improve real-world tasks across the tools you use.",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentOS",
    description: "Plan, execute, verify and improve real-world tasks across the tools you use.",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${interTight.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-fg-on-accent"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
