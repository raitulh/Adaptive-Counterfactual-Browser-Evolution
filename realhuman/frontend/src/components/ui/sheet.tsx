"use client";

import { X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Side sheet built on Radix Dialog: focus trap, Escape to close, scroll lock
 * and focus return are handled by the primitive.
 */
export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & { side?: "left" | "right" }) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-(--z-overlay) bg-black/60 backdrop-blur-sm data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />
      <SheetPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-(--z-modal) flex w-full max-w-sm flex-col border-border-strong bg-background shadow-elevated focus-visible:outline-none",
          side === "right"
            ? "right-0 border-l data-[state=closed]:animate-sheet-out data-[state=open]:animate-sheet-in"
            : "left-0 border-r data-[state=closed]:animate-sheet-out-left data-[state=open]:animate-sheet-in-left",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-3.5 right-3 inline-flex size-10 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label="Close menu"
        >
          <X className="size-5" aria-hidden />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}
