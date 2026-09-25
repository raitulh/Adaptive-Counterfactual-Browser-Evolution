"use client";

import { Plus } from "lucide-react";
import { Accordion as AccordionPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const Accordion = AccordionPrimitive.Root;

export function AccordionItem({
  className,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Item>) {
  return <AccordionPrimitive.Item className={cn("border-b border-border", className)} {...props} />;
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        className={cn(
          "group flex flex-1 items-center justify-between gap-6 py-5 text-left text-[15px] font-medium text-foreground transition-colors",
          "hover:text-white focus-visible:outline-offset-4",
          className,
        )}
        {...props}
      >
        {children}
        <span
          aria-hidden
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted transition-[transform,color,border-color] duration-300 ease-out-expo group-hover:border-border-bright group-hover:text-foreground group-data-[state=open]:rotate-45"
        >
          <Plus className="size-3.5" />
        </span>
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      className="overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("pb-5 text-body text-pretty text-muted", className)}>{children}</div>
    </AccordionPrimitive.Content>
  );
}
