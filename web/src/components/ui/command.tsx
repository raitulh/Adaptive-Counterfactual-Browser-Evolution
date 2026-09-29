"use client";

import { Command as Cmdk } from "cmdk";
import { SearchIcon } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Command = React.forwardRef<React.ComponentRef<typeof Cmdk>, React.ComponentPropsWithoutRef<typeof Cmdk>>(
  ({ className, ...props }, ref) => (
    <Cmdk
      ref={ref}
      className={cn("flex size-full flex-col overflow-hidden bg-surface-2 text-fg", className)}
      {...props}
    />
  ),
);
Command.displayName = "Command";

export function CommandInput({ className, ...props }: React.ComponentPropsWithoutRef<typeof Cmdk.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-4">
      <SearchIcon className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      <Cmdk.Input
        className={cn(
          "h-12 w-full bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle",
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({ className, ...props }: React.ComponentPropsWithoutRef<typeof Cmdk.List>) {
  return (
    <Cmdk.List
      className={cn("max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-2", className)}
      {...props}
    />
  );
}

export function CommandEmpty(props: React.ComponentPropsWithoutRef<typeof Cmdk.Empty>) {
  return <Cmdk.Empty className="py-10 text-center text-sm text-fg-subtle" {...props} />;
}

export function CommandGroup({ className, ...props }: React.ComponentPropsWithoutRef<typeof Cmdk.Group>) {
  return (
    <Cmdk.Group
      className={cn(
        "[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-subtle [&_[cmdk-group-heading]]:uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: React.ComponentPropsWithoutRef<typeof Cmdk.Item>) {
  return (
    <Cmdk.Item
      className={cn(
        "flex cursor-default items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-fg-muted outline-none select-none data-[disabled=true]:opacity-40 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-fg [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export function CommandSeparator({ className, ...props }: React.ComponentPropsWithoutRef<typeof Cmdk.Separator>) {
  return <Cmdk.Separator className={cn("-mx-2 my-1 h-px bg-line", className)} {...props} />;
}
