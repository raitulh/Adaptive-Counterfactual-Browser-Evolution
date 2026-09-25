import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface BrowserFrameProps {
  url: string;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}

/** Minimal browser chrome that frames product surfaces as real software. */
export function BrowserFrame({ url, children, aside, className }: BrowserFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border-strong bg-surface shadow-elevated",
        className,
      )}
    >
      <div className="flex h-11 items-center gap-3 border-b border-border bg-surface-raised/60 px-4">
        <div aria-hidden className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-surface-hover" />
          <span className="size-2.5 rounded-full bg-surface-hover" />
          <span className="size-2.5 rounded-full bg-surface-hover" />
        </div>
        <div className="mx-auto flex h-7 max-w-sm min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background/60 px-3 font-mono text-[11px] text-subtle">
          <Lock aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{url}</span>
        </div>
        <div className="flex min-w-[3.5rem] justify-end">{aside}</div>
      </div>
      {children}
    </div>
  );
}
