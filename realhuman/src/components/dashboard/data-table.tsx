import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/** Dense, readable table primitives. The wrapper scrolls horizontally on small screens. */
export function DataTable({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "relative overflow-x-auto rounded-xl border border-border bg-surface",
        className,
      )}
    >
      <table className="w-full min-w-[44rem] text-left text-[13px]">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "border-b border-border px-4 py-2.5 text-xs font-medium whitespace-nowrap text-subtle",
        className,
      )}
      {...props}
    />
  );
}

export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-4 py-3 whitespace-nowrap text-muted", className)} {...props} />;
}

export function Tr({ className, ...props }: ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors last:border-b-0 hover:bg-surface-raised/60",
        className,
      )}
      {...props}
    />
  );
}
