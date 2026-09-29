"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AgentCoreMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { useAuth } from "@/lib/auth/hooks";

/**
 * Google returns here (GOOGLE_LOGIN_REDIRECT_URI). The code + single-use state are handed to the
 * backend, which exchanges them (PKCE), verifies the ID token and sets the session cookie.
 */
export function GoogleCallback() {
  const params = useSearchParams();
  const router = useRouter();
  const { completeGoogleLogin } = useAuth();
  const [error, setError] = useState<unknown>(null);
  const started = useRef(false);
  const code = params.get("code");
  const state = params.get("state");
  const providerError = params.get("error");

  useEffect(() => {
    if (started.current || providerError || !code || !state) return;
    started.current = true; // the state is single-use: never exchange twice (e.g. StrictMode)
    completeGoogleLogin(code, state)
      .then((next) => router.replace(next))
      .catch(setError);
  }, [code, state, providerError, completeGoogleLogin, router]);

  if (providerError || (!code && !error)) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">Google sign-in was not completed</h1>
        <p className="text-sm text-fg-muted">
          {providerError === "access_denied"
            ? "You declined access at Google."
            : "The sign-in response was incomplete."}{" "}
          No account changes were made.
        </p>
        <Button asChild variant="primary">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-xl font-semibold tracking-tight">We couldn&apos;t sign you in</h1>
        <InlineError error={error} />
        <Button asChild variant="primary">
          <Link href="/login">Try again</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 text-center" role="status" aria-live="polite">
      <AgentCoreMark className="size-10 motion-safe:animate-pulse" />
      <p className="text-sm text-fg-muted">Completing sign-in with Google…</p>
    </div>
  );
}
