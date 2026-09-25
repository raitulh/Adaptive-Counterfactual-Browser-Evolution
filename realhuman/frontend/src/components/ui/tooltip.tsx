"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-(--z-tooltip) rounded-md border border-border-strong bg-surface-overlay px-2.5 py-1.5 text-xs text-foreground shadow-elevated",
          "data-[state=closed]:animate-fade-out data-[state=delayed-open]:animate-fade-in",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
