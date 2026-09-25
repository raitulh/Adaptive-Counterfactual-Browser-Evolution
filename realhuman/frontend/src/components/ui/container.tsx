import type { ComponentProps } from "react";
import { cn } from "@/lib/utils/cn";

const widths = {
  narrow: "max-w-narrow",
  content: "max-w-content",
  wide: "max-w-wide",
} as const;

export function Container({
  className,
  size = "content",
  ...props
}: ComponentProps<"div"> & { size?: keyof typeof widths }) {
  return <div className={cn("mx-auto w-full px-gutter", widths[size], className)} {...props} />;
}
