"use client";

import { useEffect, useRef, useState } from "react";

/** Observes an element's content box size. */
export function useElementSize<T extends HTMLElement>(initial = { width: 0, height: 0 }) {
  const ref = useRef<T>(null);
  const [size, setSize] = useState(initial);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize((previous) =>
        previous.width === width && previous.height === height ? previous : { width, height },
      );
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, size] as const;
}
