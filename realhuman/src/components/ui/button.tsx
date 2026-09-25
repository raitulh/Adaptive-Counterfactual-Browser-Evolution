import { cva, type VariantProps } from "class-variance-authority";
import { ArrowRight } from "lucide-react";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const buttonVariants = cva(
  [
    "group/button relative inline-flex shrink-0 items-center justify-center gap-2 font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-150 ease-standard",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-inverse text-inverse-foreground shadow-subtle hover:bg-white",
        secondary:
          "border border-border-strong bg-surface-raised text-foreground hover:border-border-bright hover:bg-surface-overlay",
        outline: "border border-border-strong text-foreground hover:bg-surface-raised",
        ghost: "text-muted hover:bg-surface-raised hover:text-foreground",
        danger: "border border-danger/35 bg-danger/10 text-danger hover:bg-danger/15",
        link: "h-auto px-0 text-foreground underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        sm: "h-8 rounded-md px-3 text-[13px] [&_svg]:size-3.5",
        md: "h-10 rounded-lg px-4 text-sm [&_svg]:size-4",
        lg: "h-12 rounded-lg px-5 text-[15px] [&_svg]:size-4",
        icon: "size-10 rounded-lg [&_svg]:size-[18px]",
        "icon-sm": "size-8 rounded-md [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

/** Arrow that nudges forward on hover of the parent button. */
export function ButtonArrow({ className }: { className?: string }) {
  return (
    <ArrowRight
      aria-hidden
      className={cn(
        "transition-transform duration-200 ease-out-expo group-hover/button:translate-x-0.5",
        className,
      )}
    />
  );
}
