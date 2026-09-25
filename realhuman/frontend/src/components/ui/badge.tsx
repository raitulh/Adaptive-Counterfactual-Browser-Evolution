import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-pill border font-medium whitespace-nowrap [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral: "border-border-strong bg-surface-raised text-muted",
        success: "border-success/25 bg-success/10 text-success",
        accent: "border-accent/25 bg-accent/10 text-accent",
        warning: "border-warning/25 bg-warning/10 text-warning",
        danger: "border-danger/25 bg-danger/10 text-danger",
      },
      size: {
        sm: "h-5 px-2 text-[11px]",
        md: "h-6 px-2.5 text-xs",
      },
    },
    defaultVariants: { tone: "neutral", size: "md" },
  },
);

const dotTone = {
  neutral: "bg-subtle",
  success: "bg-success",
  accent: "bg-accent",
  warning: "bg-warning",
  danger: "bg-danger",
} as const;

export interface BadgeProps extends ComponentProps<"span">, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, size, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone, size }), className)} {...props}>
      {dot ? (
        <span aria-hidden className={cn("size-1.5 rounded-full", dotTone[tone ?? "neutral"])} />
      ) : null}
      {children}
    </span>
  );
}
