import { Loader2 } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export function Separator({
  className,
  orientation = "horizontal",
}: {
  className?: string;
  orientation?: "horizontal" | "vertical";
}) {
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className,
      )}
    />
  );
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("skeleton rounded-md", className)} {...props} />;
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <>
      <Loader2 aria-hidden className={cn("size-4 animate-spin", className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border-strong bg-surface-raised px-1.5 font-mono text-[11px] text-muted",
        className,
      )}
      {...props}
    />
  );
}
