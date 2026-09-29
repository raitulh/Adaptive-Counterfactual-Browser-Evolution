"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineError } from "@/components/ui/states";
import { useAuth } from "@/lib/auth/hooks";

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1S8.7 6 12 6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.5 14.6 2.5 12 2.5 6.8 2.5 2.6 6.7 2.6 12s4.2 9.5 9.4 9.5c5.4 0 9-3.8 9-9.2 0-.6-.1-1.1-.2-1.6H12z" />
    </svg>
  );
}

/** Starts Sign in with Google using the backend-generated authorization URL (PKCE + state on the server). */
export function GoogleButton({ next, label = "Continue with Google" }: { next?: string; label?: string }) {
  const { startGoogleLogin } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="w-full"
        loading={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          try {
            await startGoogleLogin(next);
          } catch (err) {
            setError(err);
            setPending(false);
          }
        }}
      >
        {!pending && <GoogleGlyph />}
        {label}
      </Button>
      {error ? <InlineError error={error} /> : null}
    </div>
  );
}
