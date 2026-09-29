"use client";

/** Switch, Checkbox, RadioGroup, Separator, ScrollArea, Avatar, Progress, Skeleton, Kbd. */
import { CheckIcon } from "lucide-react";
import {
  Avatar as AvatarPrimitive,
  Checkbox as CheckboxPrimitive,
  Progress as ProgressPrimitive,
  RadioGroup as RadioPrimitive,
  ScrollArea as ScrollPrimitive,
  Separator as SeparatorPrimitive,
  Switch as SwitchPrimitive,
} from "radix-ui";
import * as React from "react";
import { toneClasses, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

export const Switch = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line-strong bg-surface-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent/60 data-[state=checked]:bg-accent/80",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-3.5 translate-x-0.5 rounded-full bg-fg shadow transition-transform data-[state=checked]:translate-x-[18px] data-[state=checked]:bg-fg-on-accent" />
  </SwitchPrimitive.Root>
));
Switch.displayName = "Switch";

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer size-4 shrink-0 rounded-[5px] border border-line-strong bg-surface-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-fg-on-accent",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      <CheckIcon className="size-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioPrimitive.Root>
>(({ className, ...props }, ref) => <RadioPrimitive.Root ref={ref} className={cn("grid gap-2", className)} {...props} />);
RadioGroup.displayName = "RadioGroup";

export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioPrimitive.Item>
>(({ className, ...props }, ref) => (
  <RadioPrimitive.Item
    ref={ref}
    className={cn(
      "size-4 shrink-0 rounded-full border border-line-strong bg-surface-1 outline-none focus-visible:ring-2 focus-visible:ring-accent/50 data-[state=checked]:border-accent",
      className,
    )}
    {...props}
  >
    <RadioPrimitive.Indicator className="flex items-center justify-center after:block after:size-2 after:rounded-full after:bg-accent" />
  </RadioPrimitive.Item>
));
RadioGroupItem.displayName = "RadioGroupItem";

export function Separator({ className, orientation = "horizontal", ...props }: React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      className={cn("shrink-0 bg-line", orientation === "horizontal" ? "h-px w-full" : "h-full w-px", className)}
      {...props}
    />
  );
}

export function ScrollArea({ className, children, ...props }: React.ComponentPropsWithoutRef<typeof ScrollPrimitive.Root>) {
  return (
    <ScrollPrimitive.Root className={cn("relative overflow-hidden", className)} {...props}>
      <ScrollPrimitive.Viewport className="size-full rounded-[inherit]">{children}</ScrollPrimitive.Viewport>
      <ScrollPrimitive.Scrollbar orientation="vertical" className="flex w-2 touch-none select-none p-px">
        <ScrollPrimitive.Thumb className="relative flex-1 rounded-full bg-white/15" />
      </ScrollPrimitive.Scrollbar>
    </ScrollPrimitive.Root>
  );
}

export function Avatar({ name, src, className }: { name?: string | null; src?: string | null; className?: string }) {
  const initials = (name || "?")
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
  return (
    <AvatarPrimitive.Root
      className={cn("relative inline-flex size-7 shrink-0 overflow-hidden rounded-full border border-line-strong bg-surface-3", className)}
    >
      {src && <AvatarPrimitive.Image src={src} alt="" className="size-full object-cover" />}
      <AvatarPrimitive.Fallback className="flex size-full items-center justify-center text-2xs font-semibold text-fg-muted">
        {initials}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function Progress({
  value,
  tone = "accent",
  className,
  label,
}: {
  value: number | null;
  tone?: Tone;
  className?: string;
  label?: string;
}) {
  const pct = value === null ? null : Math.max(0, Math.min(100, value));
  return (
    <ProgressPrimitive.Root
      value={pct}
      aria-label={label}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", className)}
    >
      <ProgressPrimitive.Indicator
        className={cn("h-full rounded-full transition-[width] duration-500 ease-out", toneClasses[tone].bg, pct === null && "w-1/3 motion-safe:animate-pulse")}
        style={pct === null ? undefined : { width: `${pct}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("shimmer rounded-md", className)} {...props} />;
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-line-strong bg-surface-3 px-1 font-mono text-2xs text-fg-muted",
        className,
      )}
      {...props}
    />
  );
}
