import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui/Toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "ACBE — The Self-Improvement Layer for AI Agents",
  description:
    "Adaptive Counterfactual Browser Evolution gives AI agents the ability to diagnose verified failures, rank alternatives, validate in sandboxes, and transfer learning across websites.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark scroll-smooth">
      <body className="bg-background text-foreground antialiased selection:bg-amber-500/20 selection:text-amber-300">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
