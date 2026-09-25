"use client";

import { useEffect, useState } from "react";

/**
 * Returns the id of the section currently crossing the upper third of the
 * viewport, or null when none of `ids` is active.
 */
export function useScrollSpy(ids: readonly string[], enabled = true): string | null {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join("|");

  useEffect(() => {
    if (!enabled) return;
    const elements = key
      .split("|")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    if (elements.length === 0) return;

    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        const current = elements.find((element) => visible.get(element.id));
        setActive(current?.id ?? null);
      },
      { rootMargin: "-35% 0px -60% 0px" },
    );
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [key, enabled]);

  return enabled ? active : null;
}
