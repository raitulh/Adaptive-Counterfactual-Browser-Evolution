import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

export const fieldControlClass = cn(
  "w-full rounded-lg border border-border-strong bg-surface-raised px-3 text-sm text-foreground placeholder:text-subtle",
  "transition-[border-color,box-shadow,background-color] duration-150",
  "hover:border-border-bright focus-visible:border-accent/60 focus-visible:shadow-[0_0_0_3px_rgb(94_169_247/0.18)] focus-visible:outline-none",
  "disabled:cursor-not-allowed disabled:opacity-60",
  "aria-invalid:border-warning/60 aria-invalid:focus-visible:shadow-[0_0_0_3px_rgb(243_182_75/0.18)]",
);

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(fieldControlClass, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return (
    <textarea
      className={cn(fieldControlClass, "min-h-24 py-2.5 leading-relaxed", className)}
      {...props}
    />
  );
}

export function NativeSelect({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(fieldControlClass, "h-10 appearance-none select-chevron pr-9", className)}
      {...props}
    >
      {children}
    </select>
  );
}
