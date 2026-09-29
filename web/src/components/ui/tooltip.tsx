"use client";

import { Tooltip as T } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const TooltipProvider = T.Provider;

/** Tooltip for supplementary information only — never the sole carrier of critical information. */
export function Tooltip({
  content,
  children,
  side = "top",
  align = "center",
  delayDuration,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  delayDuration?: number;
  className?: string;
}) {
  if (!content) return <>{children}</>;
  return (
    <T.Root delayDuration={delayDuration}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-50 max-w-72 rounded-md border border-line-strong bg-surface-4 px-2.5 py-1.5 text-xs leading-snug text-fg shadow-float data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0",
            className,
          )}
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
