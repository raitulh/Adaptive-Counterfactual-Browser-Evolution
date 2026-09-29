"use client";

import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { DropdownMenu as D } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = D.Root;
export const DropdownMenuTrigger = D.Trigger;
export const DropdownMenuGroup = D.Group;
export const DropdownMenuSub = D.Sub;
export const DropdownMenuRadioGroup = D.RadioGroup;

const itemBase =
  "relative flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-muted outline-none transition-colors data-[highlighted]:bg-white/[0.06] data-[highlighted]:text-fg data-[disabled]:pointer-events-none data-[disabled]:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0";

export const DropdownMenuContent = React.forwardRef<
  React.ComponentRef<typeof D.Content>,
  React.ComponentPropsWithoutRef<typeof D.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <D.Portal>
    <D.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-48 overflow-hidden rounded-xl border border-line-strong bg-surface-2 p-1 shadow-float data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
        className,
      )}
      {...props}
    />
  </D.Portal>
));
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  React.ComponentRef<typeof D.Item>,
  React.ComponentPropsWithoutRef<typeof D.Item> & { tone?: "default" | "danger" }
>(({ className, tone = "default", ...props }, ref) => (
  <D.Item
    ref={ref}
    className={cn(itemBase, tone === "danger" && "text-danger data-[highlighted]:bg-danger/10 data-[highlighted]:text-danger", className)}
    {...props}
  />
));
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ComponentRef<typeof D.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof D.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <D.CheckboxItem ref={ref} className={cn(itemBase, "pl-8", className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <D.ItemIndicator>
        <CheckIcon className="text-accent" />
      </D.ItemIndicator>
    </span>
    {children}
  </D.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = "DropdownMenuCheckboxItem";

export const DropdownMenuRadioItem = React.forwardRef<
  React.ComponentRef<typeof D.RadioItem>,
  React.ComponentPropsWithoutRef<typeof D.RadioItem>
>(({ className, children, ...props }, ref) => (
  <D.RadioItem ref={ref} className={cn(itemBase, "pl-8", className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <D.ItemIndicator>
        <span className="size-1.5 rounded-full bg-accent" />
      </D.ItemIndicator>
    </span>
    {children}
  </D.RadioItem>
));
DropdownMenuRadioItem.displayName = "DropdownMenuRadioItem";

export function DropdownMenuLabel({ className, ...props }: React.ComponentPropsWithoutRef<typeof D.Label>) {
  return <D.Label className={cn("px-2 py-1.5 text-2xs font-medium uppercase tracking-wider text-fg-subtle", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof D.Separator>) {
  return <D.Separator className={cn("-mx-1 my-1 h-px bg-line", className)} {...props} />;
}

export function DropdownMenuSubTrigger({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof D.SubTrigger>) {
  return (
    <D.SubTrigger className={cn(itemBase, "data-[state=open]:bg-white/[0.06]", className)} {...props}>
      {children}
      <ChevronRightIcon className="ml-auto" />
    </D.SubTrigger>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof D.SubContent>) {
  return (
    <D.Portal>
      <D.SubContent
        className={cn("z-50 min-w-40 rounded-xl border border-line-strong bg-surface-2 p-1 shadow-float", className)}
        {...props}
      />
    </D.Portal>
  );
}

export function DropdownMenuShortcut({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("ml-auto font-mono text-2xs text-fg-subtle", className)} {...props} />;
}
