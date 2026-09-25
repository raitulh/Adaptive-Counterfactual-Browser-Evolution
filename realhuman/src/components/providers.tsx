"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LazyMotion, MotionConfig, domAnimation } from "framer-motion";
import { useState, type ReactNode } from "react";
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

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
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
