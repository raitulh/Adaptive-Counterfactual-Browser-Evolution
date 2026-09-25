"use client";

import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isApiRequestError } from "@/lib/api/errors";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Only retry errors the API marks as retryable (network, timeouts, 5xx).
        retry: (failureCount, error) =>
          failureCount < 2 && (!isApiRequestError(error) || error.error.retryable),
      },
      mutations: { retry: false },
    },
  });
}

/**
 * A dashboard request rejected as UNAUTHORIZED means the login session is gone
 * (live mode): send the user to log in, then back to where they were.
 */
function RedirectOnUnauthorized() {
  const client = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    const handle = (error: unknown) => {
      if (!isApiRequestError(error) || error.error.code !== "UNAUTHORIZED") return;
      const { pathname, search } = window.location;
      if (!pathname.startsWith("/dashboard")) return;
      router.replace(`/login?next=${encodeURIComponent(pathname + search)}`);
    };
    const stopQueries = client.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") handle(event.action.error);
    });
    const stopMutations = client.getMutationCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "error") handle(event.action.error);
    });
    return () => {
      stopQueries();
      stopMutations();
    };
  }, [client, router]);

  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <RedirectOnUnauthorized />
      {/* LazyMotion keeps the initial bundle small; MotionConfig honors prefers-reduced-motion. */}
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={250}>
            {children}
            <Toaster
              theme="dark"
              position="bottom-right"
              gap={8}
              toastOptions={{
                classNames: {
                  toast:
                    "!rounded-xl !border !border-border-strong !bg-surface-overlay !text-foreground !shadow-elevated !font-sans",
                  description: "!text-muted",
                },
              }}
            />
          </TooltipProvider>
        </MotionConfig>
      </LazyMotion>
    </QueryClientProvider>
  );
}
