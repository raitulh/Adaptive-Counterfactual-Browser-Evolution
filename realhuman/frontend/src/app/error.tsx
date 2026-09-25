"use client";

import { RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report the digest only — never the error payload — to the console.
    if (error.digest) console.error(`[realhuman] Unhandled error (digest ${error.digest})`);
  }, [error.digest]);

  return (
    <main
      id="main"
      className="flex min-h-[70dvh] flex-col items-center justify-center gap-6 px-gutter text-center"
    >
      <div className="flex flex-col items-center gap-3">
        <p className="font-mono text-sm text-subtle">Something went wrong</p>
        <h1 className="text-h2 text-balance">We couldn&apos;t load this page.</h1>
        <p className="max-w-md text-muted">
          Try again. If the problem continues, return to the home page.
        </p>
      </div>
      <div className="flex gap-3">
        <Button onClick={reset}>
          <RotateCcw aria-hidden />
          Try again
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
