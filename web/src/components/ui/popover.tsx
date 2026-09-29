"use client";

import { Popover as P } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverAnchor = P.Anchor;
export const PopoverClose = P.Close;

export const PopoverContent = React.forwardRef<
  React.ComponentRef<typeof P.Content>,
  React.ComponentPropsWithoutRef<typeof P.Content>
>(({ className, align = "center", sideOffset = 6, ...props }, ref) => (
  <P.Portal>
    <P.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-xl border border-line-strong bg-surface-2 p-3 text-sm text-fg shadow-float outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]",
        className,
      )}
      {...props}
    />
  </P.Portal>
));
PopoverContent.displayName = "PopoverContent";
