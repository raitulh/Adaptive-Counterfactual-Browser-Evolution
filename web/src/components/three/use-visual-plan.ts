"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { planVisual, readCapabilities, readOverride, type DeviceCapabilities, type VisualPlan } from "./capabilities";

// Device capabilities are probed once per page load (a WebGL probe is not free).
let capabilities: DeviceCapabilities | null = null;
let cached: { key: string; plan: VisualPlan } | null = null;

const REDUCED = "(prefers-reduced-motion: reduce)";

function clientPlan(): VisualPlan {
  if (!capabilities) capabilities = readCapabilities(window);
  const reducedMotion = window.matchMedia(REDUCED).matches;
  const override = readOverride(window.location.search);
  const key = `${reducedMotion}|${override}`;
  if (!cached || cached.key !== key) {
    cached = { key, plan: planVisual({ ...capabilities, reducedMotion }, override) };
  }
  return cached.plan;
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** The render plan for this device; `null` during SSR and hydration (render the 2D fallback). */
export function useVisualPlan(): VisualPlan | null {
  return useSyncExternalStore(subscribe, clientPlan, () => null);
}

/** Whether an element intersects the viewport (with margin), for pausing work offscreen. */
export function useInViewport<T extends Element>(ref: RefObject<T | null>, rootMargin = "0px"): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

/** True once the browser is idle after hydration — heavy visuals mount then, never before first paint. */
export function useIdleReady(timeout = 1200): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setReady(true), { timeout });
      return () => w.cancelIdleCallback?.(h);
    }
    const t = setTimeout(() => setReady(true), 200);
    return () => clearTimeout(t);
  }, [timeout]);
  return ready;
}
