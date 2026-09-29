"use client";

/**
 * Drawer (vaul): bottom sheet on mobile, and Sheet: side panel on desktop (Radix Dialog).
 */
import { XIcon } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import * as React from "react";
import { Drawer as Vaul } from "vaul";
import { cn } from "@/lib/utils";

export const Drawer = Vaul.Root;
export const DrawerTrigger = Vaul.Trigger;
export const DrawerClose = Vaul.Close;
export const DrawerTitle = Vaul.Title;
export const DrawerDescription = Vaul.Description;

export function DrawerContent({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof Vaul.Content>) {
  return (
    <Vaul.Portal>
      <Vaul.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <Vaul.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-line-strong bg-surface-2 outline-none",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-3 mb-1 h-1 w-10 shrink-0 rounded-full bg-white/15" aria-hidden />
        {children}
      </Vaul.Content>
    </Vaul.Portal>
  );
}

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

export function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { side?: "right" | "left" }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-full max-w-md flex-col border-line-strong bg-surface-1 shadow-float duration-300 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
          side === "right"
            ? "right-0 border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
            : "left-0 border-r data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left",
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute top-3 right-3 rounded-md p-1.5 text-fg-subtle hover:bg-white/5 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50">
          <XIcon className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
