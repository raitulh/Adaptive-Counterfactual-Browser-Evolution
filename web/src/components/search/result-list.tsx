"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Keyboard-first result list: ↑/↓ (or j/k) move between results, Home/End jump, Enter runs a
 * result's primary action, Esc returns to the search box. Inner links and buttons stay tabbable.
 */
export function ResultList({
  label,
  onEscape,
  children,
  className,
  as = "ol",
}: {
  label: string;
  onEscape?: () => void;
  children: React.ReactNode;
  className?: string;
  /** "div" when the children already render their own list. */
  as?: "ol" | "div";
}) {
  const ref = React.useRef<HTMLElement>(null);
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    // React events bubble through portals: ignore keys from dialogs/menus opened by a result.
    if (!ref.current?.contains(e.target as Node)) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>("[data-result]"));
    if (items.length === 0) return;
    const current = items.findIndex((el) => el === document.activeElement || el.contains(document.activeElement));
    const move = (idx: number) => {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, idx))]?.focus();
    };
    const typing = (e.target as HTMLElement).closest("input, textarea, [contenteditable=true]");
    if (typing) return;
    switch (e.key) {
      case "ArrowDown":
      case "j":
        move(current + 1);
        break;
      case "ArrowUp":
      case "k":
        if (current <= 0 && onEscape) {
          e.preventDefault();
          onEscape();
        } else move(current - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "Escape":
        if (onEscape) {
          e.preventDefault();
          onEscape();
        }
        break;
    }
  };
  if (as === "div") {
    return (
      <div
        ref={ref as React.RefObject<HTMLDivElement>}
        role="group"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn("flex flex-col gap-3", className)}
      >
        {children}
      </div>
    );
  }
  return (
    <ol
      ref={ref as React.RefObject<HTMLOListElement>}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("flex flex-col gap-3", className)}
    >
      {children}
    </ol>
  );
}

/** One focusable result. Enter (on the item itself) triggers `onOpen`. */
export function ResultItem({
  onOpen,
  label,
  children,
  className,
}: {
  onOpen?: () => void;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <li>
      <article
        data-result
        tabIndex={0}
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target === e.currentTarget && onOpen) {
            e.preventDefault();
            onOpen();
          }
        }}
        className={cn(
          "group/result relative rounded-xl border border-line bg-surface-1 p-4 transition-colors duration-150 outline-none hover:border-line-strong focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/25 sm:p-5",
          className,
        )}
      >
        {children}
      </article>
    </li>
  );
}

/** Focus the first result (used after a search completes via ↓ from the input). */
export function focusFirstResult(root: ParentNode | null) {
  root?.querySelector<HTMLElement>("[data-result]")?.focus();
}
