import Link from "next/link";
import { Button, ButtonArrow } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";

export default function NotFound() {
  return (
    <main
      id="main"
      className="relative flex min-h-dvh flex-col items-center justify-center gap-8 px-gutter text-center"
    >
      <div aria-hidden className="absolute inset-0 -z-10 bg-grid" />
      <Link href="/" className="rounded-md" aria-label="Home">
        <Logo />
      </Link>
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono text-sm text-subtle">404 · not found</p>
        <h1 className="text-h2 text-balance">This page could not be verified.</h1>
        <p className="max-w-md text-muted">The link may be outdated, or the page may have moved.</p>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/">
            Back to home
            <ButtonArrow />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/docs">Documentation</Link>
        </Button>
      </div>
    </main>
  );
}
