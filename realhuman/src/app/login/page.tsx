import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm, type AuthMode } from "@/components/auth/login-form";
import { Logo } from "@/components/ui/logo";
import { VerificationRing } from "@/components/visuals/verification-ring";
import { siteConfig } from "@/lib/constants/site";

export const metadata: Metadata = {
  title: "Log in",
  description: `Log in to ${siteConfig.name} or create an account to get API keys.`,
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode } = await searchParams;
  const authMode: AuthMode = mode === "signup" ? "signup" : "signin";

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <main id="main" tabIndex={-1} className="flex flex-col px-gutter py-6 outline-none sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" className="rounded-md" aria-label={`${siteConfig.name} home`}>
            <Logo />
          </Link>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted transition-colors hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Back to site
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center py-16">
          <LoginForm key={authMode} mode={authMode} />
        </div>
        <p className="text-center text-xs text-subtle lg:text-left">{siteConfig.tagline}</p>
      </main>

      <aside
        aria-label="About verification"
        className="relative hidden overflow-hidden border-l border-border bg-surface/40 lg:flex lg:items-center lg:justify-center"
      >
        <div aria-hidden className="absolute inset-0 bg-grid" />
        <VerificationRing showMark className="w-[34rem] max-w-[80%]" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-10">
          <p className="max-w-sm text-lg font-medium tracking-tight">
            Every session starts anonymous.
          </p>
          <p className="max-w-sm text-sm text-muted">
            Signals, not puzzles, decide what happens next — and your policy stays in charge.
          </p>
        </div>
      </aside>
    </div>
  );
}
