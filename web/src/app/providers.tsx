"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth/auth-provider";
import { env } from "@/lib/config/env";
import { makeQueryClient } from "@/lib/query/client";
import { useUiStore } from "@/stores/ui";

const QueryDevtools = env.isDevelopment
  ? dynamic(() => import("@tanstack/react-query-devtools").then((m) => m.ReactQueryDevtools), { ssr: false })
  : () => null;

/** Development-only query inspector; skipped in automated browsers (e2e) to keep them deterministic. */
const noopSubscribe = () => () => {};

function Devtools() {
  const show = useSyncExternalStore(
    noopSubscribe,
    () => env.isDevelopment && !navigator.webdriver,
    () => false,
  );
  return show ? <QueryDevtools buttonPosition="bottom-left" /> : null;
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  useEffect(() => {
    void useUiStore.persist.rehydrate();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={250} skipDelayDuration={100}>
            {children}
            <Toaster />
          </TooltipProvider>
        </MotionConfig>
      </AuthProvider>
      <Devtools />
    </QueryClientProvider>
  );
}
