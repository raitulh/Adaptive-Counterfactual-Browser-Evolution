"use client";

import { CheckIcon, ChevronDownIcon } from "lucide-react";
import { Select as S } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = S.Root;
export const SelectGroup = S.Group;
export const SelectValue = S.Value;

export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof S.Trigger>,
  React.ComponentPropsWithoutRef<typeof S.Trigger>
>(({ className, children, ...props }, ref) => (
  <S.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface-1 px-3 text-sm text-fg outline-none transition-colors focus-visible:border-accent/60 focus-visible:ring-2 focus-visible:ring-accent/25 disabled:opacity-50 data-[placeholder]:text-fg-subtle aria-[invalid=true]:border-danger/60 [&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <S.Icon asChild>
      <ChevronDownIcon className="size-4 shrink-0 text-fg-subtle" />
    </S.Icon>
  </S.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof S.Content>,
  React.ComponentPropsWithoutRef<typeof S.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <S.Portal>
    <S.Content
      ref={ref}
      position={position}
      sideOffset={6}
      className={cn(
        "z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className,
      )}
      {...props}
    >
      <S.Viewport className="p-1">{children}</S.Viewport>
    </S.Content>
  </S.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectItem = React.forwardRef<React.ComponentRef<typeof S.Item>, React.ComponentPropsWithoutRef<typeof S.Item>>(
  ({ className, children, ...props }, ref) => (
    <S.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-[13px] text-fg-muted outline-none data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-fg data-[disabled]:opacity-40",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <S.ItemIndicator>
          <CheckIcon className="size-4 text-accent" />
        </S.ItemIndicator>
      </span>
      <S.ItemText>{children}</S.ItemText>
    </S.Item>
  ),
);
SelectItem.displayName = "SelectItem";

export function SelectLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof S.Label>) {
  return <S.Label className={cn("px-2 py-1.5 text-2xs uppercase tracking-wider text-fg-subtle", className)} {...props} />;
}
