"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a CSS media query. Returns `serverValue` during SSR and
 * hydration, then the real value — without hydration mismatches.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

export const usePrefersReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
/** True on devices with a precise pointer that can hover (mouse, trackpad). */
export const useFinePointer = () => useMediaQuery("(hover: hover) and (pointer: fine)");
