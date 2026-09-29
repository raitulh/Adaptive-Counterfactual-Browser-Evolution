"use client";

import { CloudOffIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { AgentCoreMark } from "@/components/brand/logo";
import { useAuth } from "@/lib/auth/hooks";

/**
 * Client-side session gate for /app. This is UX only: every API call is authorized by the backend,
 * and a missing/expired session simply yields 401s that send the user to sign in.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, retry } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`/login?next=${encodeURIComponent(pathname || "/app")}`);
    }
  }, [status, router, pathname]);

  if (status === "authenticated") return <>{children}</>;

  if (status === "unreachable") {
    return (
      <div className="flex min-h-dvh items-center justify-center p-6">
        <EmptyState
          icon={<CloudOffIcon />}
          title="Can't reach AgentOS"
          description="Your session is safe, but the AgentOS API isn't responding right now. Check your connection or try again in a moment."
          action={<Button onClick={retry}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <AgentCoreMark className="size-10 motion-safe:animate-pulse" />
      <p className="text-sm text-fg-muted">Restoring your session…</p>
    </div>
  );
}
