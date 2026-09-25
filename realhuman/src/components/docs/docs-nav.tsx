"use client";

import { useScrollSpy } from "@/hooks/use-scroll-spy";
import { cn } from "@/lib/utils/cn";

export interface DocsNavItem {
  id: string;
  label: string;
}

/** Sticky table of contents with the current section highlighted. */
export function DocsNav({ items }: { items: readonly DocsNavItem[] }) {
  const active = useScrollSpy(items.map((item) => item.id)) ?? items[0]?.id;
  return (
    <nav aria-label="Documentation" className="lg:sticky lg:top-24">
      <p className="mb-3 eyebrow">On this page</p>
      <ul className="scrollbar-none flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:border-l lg:border-border lg:pb-0">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? "location" : undefined}
              className={cn(
                "block rounded-md px-3 py-1.5 text-[13px] whitespace-nowrap transition-colors lg:-ml-px lg:rounded-none lg:border-l",
                active === item.id
                  ? "bg-surface-raised text-foreground lg:border-foreground lg:bg-transparent"
                  : "text-muted hover:text-foreground lg:border-transparent",
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
